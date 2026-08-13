import { Router, type NextFunction, type Request, type Response } from "express";
import { rateLimit } from "express-rate-limit";
import { BatchStatus, KeyStatus, PaymentMethod } from "@prisma/client";
import { z } from "zod";
import { createSession, destroySession, requireOwnInstitution, requireSession } from "./auth.js";
import { launchBatch } from "./batch-runner.js";
import { BlinkApiError, BlinkClient } from "./blink.js";
import { getConfig } from "./config.js";
import { CsvValidationError, parseRecipientsCsv } from "./csv-parser.js";
import { prisma } from "./db.js";
import { encryptApiKey } from "./encryption.js";
import { AppError } from "./errors.js";

const router = Router();

const registrationLimiter = rateLimit({
  windowMs: 15 * 60 * 1_000,
  limit: 10,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});

const institutionIdSchema = z
  .string()
  .trim()
  .min(3)
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/, "Use letters, numbers, hyphens, or underscores")
  .transform((value) => value.toUpperCase());

const registerSchema = z.object({
  institutionId: institutionIdSchema,
  blinkApiKey: z.string().trim().min(16).max(512),
});

const uploadSchema = z.object({
  csvData: z.string().min(1),
  paymentMethod: z.enum(PaymentMethod).default(PaymentMethod.LIGHTNING_ADDRESS),
});

const paySchema = z.object({
  batchId: z.string().cuid(),
  acknowledgeIrreversible: z.literal(true),
});

function asyncRoute(
  handler: (request: Request, response: Response, next: NextFunction) => Promise<void>,
) {
  return (request: Request, response: Response, next: NextFunction): void => {
    void handler(request, response, next).catch(next);
  };
}

function serializeInstitution(institution: NonNullable<Request["institution"]>) {
  return {
    id: institution.id,
    blinkUsername: institution.blinkUsername,
    walletCurrency: institution.walletCurrency,
    balance: institution.balanceSnapshot?.toString() ?? null,
    keyStatus: institution.keyStatus,
    keyVerifiedAt: institution.keyVerifiedAt?.toISOString() ?? null,
    keyPurgedAt: institution.keyPurgedAt?.toISOString() ?? null,
  };
}

function serializeBatch<T extends {
  id: string;
  institutionId: string;
  status: BatchStatus;
  paymentMethod: PaymentMethod;
  recipientsTotal: number;
  totalAmount: bigint;
  successfulPayments: number;
  failedPayments: number;
  errorMessage: string | null;
  startedAt: Date | null;
  completedAt: Date | null;
  keyPurgedAt: Date | null;
  createdAt: Date;
}>(batch: T) {
  return {
    id: batch.id,
    institutionId: batch.institutionId,
    status: batch.status,
    paymentMethod: batch.paymentMethod,
    recipientsTotal: batch.recipientsTotal,
    totalAmount: batch.totalAmount.toString(),
    successfulPayments: batch.successfulPayments,
    failedPayments: batch.failedPayments,
    errorMessage: batch.errorMessage,
    startedAt: batch.startedAt?.toISOString() ?? null,
    completedAt: batch.completedAt?.toISOString() ?? null,
    keyPurgedAt: batch.keyPurgedAt?.toISOString() ?? null,
    createdAt: batch.createdAt.toISOString(),
  };
}

router.post(
  "/institutions/register",
  registrationLimiter,
  asyncRoute(async (request, response) => {
    const config = getConfig();
    const parsed = registerSchema.parse(request.body);
    const apiKey = Buffer.from(parsed.blinkApiKey, "utf8");
    parsed.blinkApiKey = "";
    if (request.body && typeof request.body === "object") delete request.body.blinkApiKey;

    try {
      const blink = new BlinkClient({ endpoint: config.BLINK_GRAPHQL_URL, timeoutMs: 15_000 });
      let verified;
      try {
        verified = await blink.verifyApiKey(apiKey, config.DEFAULT_WALLET_CURRENCY);
      } catch (error) {
        if (error instanceof AppError) throw error;
        if (error instanceof BlinkApiError) {
          const isAuth = /auth|permission|token|api.?key/i.test(`${error.code} ${error.message}`);
          throw new AppError(
            isAuth ? 401 : 502,
            isAuth ? "BLINK_KEY_REJECTED" : error.code,
            error.message,
          );
        }
        throw error;
      }

      const existing = await prisma.institution.findUnique({ where: { id: parsed.institutionId } });
      if (existing && existing.blinkUserId !== verified.userId) {
        throw new AppError(
          409,
          "INSTITUTION_ID_TAKEN",
          "This institution ID belongs to a different Blink account",
        );
      }
      if (existing) {
        const processing = await prisma.batch.count({
          where: { institutionId: existing.id, status: BatchStatus.PROCESSING },
        });
        if (processing > 0) {
          throw new AppError(409, "BATCH_IN_PROGRESS", "Wait for the active batch to finish before replacing the key");
        }
      }

      const keyVersion = (existing?.keyVersion ?? 0) + 1;
      const encrypted = encryptApiKey(
        apiKey,
        config.ENCRYPTION_SECRET,
        parsed.institutionId,
        keyVersion,
      );
      const now = new Date();

      const institution = await prisma.$transaction(async (tx) => {
        const saved = await tx.institution.upsert({
          where: { id: parsed.institutionId },
          create: {
            id: parsed.institutionId,
            blinkUserId: verified.userId,
            blinkUsername: verified.username,
            walletId: verified.wallet.id,
            walletCurrency: verified.wallet.currency,
            balanceSnapshot: verified.wallet.balance,
            keyCiphertext: encrypted.ciphertext,
            keyIv: encrypted.iv,
            keyAuthTag: encrypted.authTag,
            keyStatus: KeyStatus.ACTIVE,
            keyVersion,
            keyVerifiedAt: now,
            keyPurgedAt: null,
          },
          update: {
            blinkUsername: verified.username,
            walletId: verified.wallet.id,
            walletCurrency: verified.wallet.currency,
            balanceSnapshot: verified.wallet.balance,
            keyCiphertext: encrypted.ciphertext,
            keyIv: encrypted.iv,
            keyAuthTag: encrypted.authTag,
            keyStatus: KeyStatus.ACTIVE,
            keyVersion,
            keyVerifiedAt: now,
            keyPurgedAt: null,
          },
        });
        // Key rotation also rotates every application session for this institution.
        await tx.session.deleteMany({ where: { institutionId: saved.id } });
        await tx.auditEvent.create({
          data: {
            institutionId: saved.id,
            type: existing ? "KEY_REVERIFIED" : "INSTITUTION_REGISTERED",
            details: {
              walletCurrency: verified.wallet.currency,
              scopes: verified.scopes,
              keyVersion,
            },
          },
        });
        return saved;
      });

      await createSession(institution.id, response);
      response.status(existing ? 200 : 201).json({
        institutionId: institution.id,
        status: "verified",
        institution: serializeInstitution(institution),
        permissions: verified.scopes,
      });
    } finally {
      apiKey.fill(0);
    }
  }),
);

router.get(
  "/session",
  requireSession,
  asyncRoute(async (request, response) => {
    response.json({ institution: serializeInstitution(request.institution!) });
  }),
);

router.delete(
  "/session",
  asyncRoute(async (request, response) => {
    await destroySession(request, response);
    response.status(204).send();
  }),
);

router.get(
  "/institutions/:id",
  requireSession,
  requireOwnInstitution,
  asyncRoute(async (request, response) => {
    response.json({ institution: serializeInstitution(request.institution!) });
  }),
);

router.post(
  "/institutions/:id/upload-csv",
  requireSession,
  requireOwnInstitution,
  asyncRoute(async (request, response) => {
    const config = getConfig();
    const body = uploadSchema.parse(request.body);
    const institution = await prisma.institution.findUniqueOrThrow({
      where: { id: String(request.params.id) },
    });
    if (institution.keyStatus !== KeyStatus.ACTIVE) {
      throw new AppError(409, "KEY_REQUIRED", "Provide and verify a new Blink API key before creating a batch");
    }

    const parsed = parseRecipientsCsv(body.csvData, config.MAX_BATCH_RECIPIENTS);
    const batch = await prisma.batch.create({
      data: {
        institutionId: institution.id,
        status: BatchStatus.DRAFT,
        paymentMethod: body.paymentMethod,
        recipientsTotal: parsed.recipients.length,
        totalAmount: parsed.totalAmount,
        recipients: {
          create: parsed.recipients.map((recipient) => ({
            rowNumber: recipient.rowNumber,
            address: recipient.address,
            amount: recipient.amount,
            memo: recipient.memo,
          })),
        },
      },
      include: { recipients: { orderBy: { rowNumber: "asc" } } },
    });

    await prisma.auditEvent.create({
      data: {
        institutionId: institution.id,
        batchId: batch.id,
        type: "CSV_VALIDATED",
        details: { recipients: batch.recipientsTotal, totalAmount: batch.totalAmount.toString() },
      },
    });

    response.status(201).json({
      batch: serializeBatch(batch),
      recipients: batch.recipients,
      warnings:
        body.paymentMethod === PaymentMethod.LIGHTNING_ADDRESS
          ? ["Blink's Lightning-address mutation does not transmit memo text; memos remain in this report."]
          : ["Intra-ledger mode requires each Rurbit username to resolve to a Blink wallet."],
    });
  }),
);

router.post(
  "/institutions/:id/pay-batch",
  requireSession,
  requireOwnInstitution,
  asyncRoute(async (request, response) => {
    const body = paySchema.parse(request.body);
    const institutionId = request.institution!.id;

    const claimed = await prisma.$transaction(async (tx) => {
      const batch = await tx.batch.findFirst({
        where: { id: body.batchId, institutionId },
      });
      if (!batch) throw new AppError(404, "BATCH_NOT_FOUND", "Batch was not found");
      if (batch.status !== BatchStatus.DRAFT) {
        throw new AppError(409, "BATCH_ALREADY_STARTED", `Batch is already ${batch.status.toLowerCase()}`);
      }

      const institution = await tx.institution.findUniqueOrThrow({ where: { id: institutionId } });
      if (institution.keyStatus !== KeyStatus.ACTIVE || !institution.keyCiphertext) {
        throw new AppError(409, "KEY_REQUIRED", "A verified Blink API key is required");
      }
      const activeBatch = await tx.batch.count({
        where: { institutionId, status: BatchStatus.PROCESSING },
      });
      if (activeBatch > 0) throw new AppError(409, "BATCH_IN_PROGRESS", "Another batch is already running");

      const result = await tx.batch.updateMany({
        where: { id: batch.id, status: BatchStatus.DRAFT },
        data: {
          status: BatchStatus.PROCESSING,
          startedAt: new Date(),
          keyVersionUsed: institution.keyVersion,
        },
      });
      if (result.count !== 1) throw new AppError(409, "BATCH_ALREADY_STARTED", "Batch was already started");

      await tx.auditEvent.create({
        data: {
          institutionId,
          batchId: batch.id,
          type: "BATCH_STARTED",
          details: { paymentMethod: batch.paymentMethod, recipients: batch.recipientsTotal },
        },
      });
      return batch.id;
    });

    launchBatch(claimed);
    response.status(202).json({ batchId: claimed, status: BatchStatus.PROCESSING });
  }),
);

router.get(
  "/institutions/:id/batches",
  requireSession,
  requireOwnInstitution,
  asyncRoute(async (request, response) => {
    const batches = await prisma.batch.findMany({
      where: { institutionId: request.institution!.id },
      orderBy: { createdAt: "desc" },
      take: 20,
    });
    response.json({ batches: batches.map(serializeBatch) });
  }),
);

router.get(
  "/institutions/:id/batches/:batchId",
  requireSession,
  requireOwnInstitution,
  asyncRoute(async (request, response) => {
    const batchId = String(request.params.batchId);
    const batch = await prisma.batch.findFirst({
      where: { id: batchId, institutionId: request.institution!.id },
      include: { recipients: { orderBy: { rowNumber: "asc" } } },
    });
    if (!batch) throw new AppError(404, "BATCH_NOT_FOUND", "Batch was not found");
    response.json({ batch: serializeBatch(batch), recipients: batch.recipients });
  }),
);

router.get("/healthz", (_request, response) => response.json({ status: "ok" }));

router.use((request, _response, next) => {
  next(new AppError(404, "NOT_FOUND", `No API route for ${request.method} ${request.path}`));
});

export { router as apiRouter, CsvValidationError };
