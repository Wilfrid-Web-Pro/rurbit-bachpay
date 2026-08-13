import { setTimeout as sleep } from "node:timers/promises";
import { BatchStatus, KeyStatus, RecipientStatus } from "@prisma/client";
import { BlinkApiError, BlinkClient } from "./blink.js";
import { getConfig } from "./config.js";
import { prisma } from "./db.js";
import { decryptApiKey } from "./encryption.js";
import { errorMessage } from "./errors.js";
import { logger } from "./logger.js";

const activeBatches = new Set<string>();

function paymentFailure(error: unknown): { code: string; message: string } {
  if (error instanceof BlinkApiError) return { code: error.code, message: error.message };
  return { code: "PAYMENT_ERROR", message: errorMessage(error) };
}

export function launchBatch(batchId: string): void {
  if (activeBatches.has(batchId)) return;
  activeBatches.add(batchId);

  void executeClaimedBatch(batchId)
    .catch((error: unknown) => {
      logger.error({ err: error, batchId }, "Batch runner failed");
    })
    .finally(() => activeBatches.delete(batchId));
}

async function executeClaimedBatch(batchId: string): Promise<void> {
  const config = getConfig();
  const blink = new BlinkClient({ endpoint: config.BLINK_GRAPHQL_URL });
  let apiKey: Buffer | undefined;
  let fatalError: string | undefined;
  let institutionId: string | undefined;
  let keyVersion: number | undefined;

  try {
    const batch = await prisma.batch.findUnique({
      where: { id: batchId },
      include: {
        institution: true,
        recipients: { orderBy: { rowNumber: "asc" } },
      },
    });

    if (!batch || batch.status !== BatchStatus.PROCESSING) throw new Error("Claimed batch was not found");
    institutionId = batch.institutionId;
    keyVersion = batch.keyVersionUsed ?? undefined;

    const institution = batch.institution;
    if (
      institution.keyStatus !== KeyStatus.ACTIVE ||
      !institution.keyCiphertext ||
      !institution.keyIv ||
      !institution.keyAuthTag ||
      institution.keyVersion !== batch.keyVersionUsed
    ) {
      throw new Error("No matching active Blink API key is available for this batch");
    }

    apiKey = decryptApiKey(
      {
        ciphertext: institution.keyCiphertext,
        iv: institution.keyIv,
        authTag: institution.keyAuthTag,
      },
      config.ENCRYPTION_SECRET,
      institution.id,
      institution.keyVersion,
    );

    for (let index = 0; index < batch.recipients.length; index += 1) {
      const recipient = batch.recipients[index];
      if (!recipient || recipient.status !== RecipientStatus.PENDING) continue;

      await prisma.batchRecipient.update({
        where: { id: recipient.id },
        data: { status: RecipientStatus.PROCESSING },
      });

      try {
        const result = await blink.sendPayment({
          apiKey,
          method: batch.paymentMethod,
          senderWalletId: institution.walletId,
        walletCurrency: institution.walletCurrency === "USD" ? "USD" : "BTC",
          address: recipient.address,
          amount: recipient.amount,
          memo: recipient.memo,
        });

        await prisma.$transaction([
          prisma.batchRecipient.update({
            where: { id: recipient.id },
            data: {
              status: RecipientStatus.SUCCESS,
              blinkStatus: result.status,
              transactionId: result.transactionId,
              processedAt: new Date(),
            },
          }),
          prisma.batch.update({
            where: { id: batch.id },
            data: { successfulPayments: { increment: 1 } },
          }),
        ]);
      } catch (error) {
        const failure = paymentFailure(error);
        await prisma.$transaction([
          prisma.batchRecipient.update({
            where: { id: recipient.id },
            data: {
              status: RecipientStatus.FAILED,
              errorCode: failure.code.slice(0, 64),
              errorMessage: failure.message,
              processedAt: new Date(),
            },
          }),
          prisma.batch.update({
            where: { id: batch.id },
            data: { failedPayments: { increment: 1 } },
          }),
        ]);
      }

      if (index < batch.recipients.length - 1 && config.PAYMENT_DELAY_MS > 0) {
        await sleep(config.PAYMENT_DELAY_MS);
      }
    }
  } catch (error) {
    fatalError = errorMessage(error);
    logger.error({ err: error, batchId }, "Batch stopped before all recipients were processed");
  } finally {
    apiKey?.fill(0);

    try {
      const now = new Date();
      await prisma.$transaction(async (tx) => {
        if (fatalError) {
          await tx.batchRecipient.updateMany({
            where: { batchId, status: RecipientStatus.PENDING },
            data: {
              status: RecipientStatus.FAILED,
              errorCode: "BATCH_STOPPED",
              errorMessage: "Not attempted because the batch stopped unexpectedly",
              processedAt: now,
            },
          });
          await tx.batchRecipient.updateMany({
            where: { batchId, status: RecipientStatus.PROCESSING },
            data: {
              status: RecipientStatus.FAILED,
              errorCode: "OUTCOME_UNKNOWN",
              errorMessage: "Payment outcome is unknown; verify in Blink before retrying",
              processedAt: now,
            },
          });
        }

        const counts = await tx.batchRecipient.groupBy({
          by: ["status"],
          where: { batchId },
          _count: { _all: true },
        });
        const successes = counts.find((item) => item.status === RecipientStatus.SUCCESS)?._count._all ?? 0;
        const failures = counts.find((item) => item.status === RecipientStatus.FAILED)?._count._all ?? 0;
        const finalStatus = fatalError
          ? BatchStatus.FAILED
          : failures > 0
            ? BatchStatus.COMPLETED_WITH_ERRORS
            : BatchStatus.COMPLETED;

        await tx.batch.update({
          where: { id: batchId },
          data: {
            status: finalStatus,
            successfulPayments: successes,
            failedPayments: failures,
            errorMessage: fatalError ?? null,
            completedAt: now,
            keyPurgedAt: now,
          },
        });

        if (institutionId && keyVersion !== undefined) {
          await tx.institution.updateMany({
            where: { id: institutionId, keyVersion, keyStatus: KeyStatus.ACTIVE },
            data: {
              keyCiphertext: null,
              keyIv: null,
              keyAuthTag: null,
              keyStatus: KeyStatus.PURGED,
              keyPurgedAt: now,
            },
          });
          await tx.auditEvent.create({
            data: {
              institutionId,
              batchId,
              type: "LOCAL_KEY_PURGED",
              details: { remoteRevocationConfirmed: false },
            },
          });
        }
      });
    } catch (cleanupError) {
      logger.fatal({ err: cleanupError, batchId }, "Could not persist batch completion or local key purge");
    }
  }
}

export async function recoverInterruptedBatches(): Promise<void> {
  const interrupted = await prisma.batch.findMany({
    where: { status: BatchStatus.PROCESSING },
    select: { id: true, institutionId: true, keyVersionUsed: true },
  });

  for (const batch of interrupted) {
    const now = new Date();
    await prisma.$transaction(async (tx) => {
      await tx.batchRecipient.updateMany({
        where: { batchId: batch.id, status: { in: [RecipientStatus.PENDING, RecipientStatus.PROCESSING] } },
        data: {
          status: RecipientStatus.FAILED,
          errorCode: "SERVER_INTERRUPTED",
          errorMessage: "The server restarted; verify Blink history before retrying any unknown payment",
          processedAt: now,
        },
      });
      const failed = await tx.batchRecipient.count({
        where: { batchId: batch.id, status: RecipientStatus.FAILED },
      });
      const success = await tx.batchRecipient.count({
        where: { batchId: batch.id, status: RecipientStatus.SUCCESS },
      });
      await tx.batch.update({
        where: { id: batch.id },
        data: {
          status: BatchStatus.FAILED,
          failedPayments: failed,
          successfulPayments: success,
          errorMessage: "Server interrupted the batch; automatic resume was blocked to prevent duplicate payments",
          completedAt: now,
          keyPurgedAt: now,
        },
      });
      if (batch.keyVersionUsed !== null) {
        await tx.institution.updateMany({
          where: {
            id: batch.institutionId,
            keyVersion: batch.keyVersionUsed,
            keyStatus: KeyStatus.ACTIVE,
          },
          data: {
            keyCiphertext: null,
            keyIv: null,
            keyAuthTag: null,
            keyStatus: KeyStatus.PURGED,
            keyPurgedAt: now,
          },
        });
      }
    });
  }

  if (interrupted.length > 0) {
    logger.warn({ count: interrupted.length }, "Failed interrupted batches and purged matching local keys");
  }
}
