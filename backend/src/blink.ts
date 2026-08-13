import { setTimeout as sleep } from "node:timers/promises";
import type { PaymentMethod } from "@prisma/client";
import { AppError } from "./errors.js";

interface GraphqlError {
  message?: string;
  extensions?: { code?: string };
}

interface GraphqlEnvelope<T> {
  data?: T;
  errors?: GraphqlError[];
}

interface BlinkPayloadError {
  code?: string;
  message?: string;
  path?: string[];
}

export class BlinkApiError extends Error {
  constructor(
    message: string,
    public readonly code = "BLINK_API_ERROR",
    public readonly httpStatus?: number,
    public readonly retryAfterMs?: number,
  ) {
    super(message);
    this.name = "BlinkApiError";
  }
}

interface BlinkClientOptions {
  endpoint: string;
  timeoutMs?: number;
}

export interface VerifiedBlinkKey {
  userId: string;
  username: string | null;
  scopes: string[];
  wallet: { id: string; currency: "BTC" | "USD"; balance: bigint };
}

export interface BlinkPaymentResult {
  status: string;
  transactionId: string | null;
}

export class BlinkClient {
  private readonly endpoint: string;
  private readonly timeoutMs: number;

  constructor(options: BlinkClientOptions) {
    this.endpoint = options.endpoint;
    this.timeoutMs = options.timeoutMs ?? 30_000;
  }

  private async request<T>(apiKey: Buffer, query: string, variables: Record<string, unknown> = {}): Promise<T> {
    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": apiKey.toString("utf8"),
        },
        body: JSON.stringify({ query, variables }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
    } catch (error) {
      const message = error instanceof Error && error.name === "TimeoutError"
        ? "Blink did not respond before the request timed out"
        : "Could not connect to Blink";
      throw new BlinkApiError(message, "BLINK_NETWORK_ERROR");
    }

    if (!response.ok) {
      const retryAfter = response.headers.get("retry-after");
      const retryAfterMs = retryAfter ? Math.min(Number(retryAfter) * 1_000, 10_000) : undefined;
      throw new BlinkApiError(
        response.status === 429 ? "Blink rate limit reached" : `Blink returned HTTP ${response.status}`,
        response.status === 429 ? "RATE_LIMITED" : "BLINK_HTTP_ERROR",
        response.status,
        Number.isFinite(retryAfterMs) ? retryAfterMs : undefined,
      );
    }

    let envelope: GraphqlEnvelope<T>;
    try {
      envelope = (await response.json()) as GraphqlEnvelope<T>;
    } catch {
      throw new BlinkApiError("Blink returned an invalid response", "INVALID_BLINK_RESPONSE");
    }

    if (envelope.errors?.length) {
      const first = envelope.errors[0];
      throw new BlinkApiError(
        first?.message ?? "Blink rejected the request",
        first?.extensions?.code ?? "BLINK_GRAPHQL_ERROR",
      );
    }
    if (!envelope.data) {
      throw new BlinkApiError("Blink returned no data", "EMPTY_BLINK_RESPONSE");
    }

    return envelope.data;
  }

  async verifyApiKey(apiKey: Buffer, preferredCurrency: "BTC" | "USD"): Promise<VerifiedBlinkKey> {
    const data = await this.request<{
      authorization: { scopes: string[] };
      me: {
        id: string;
        username: string | null;
        defaultAccount: {
          wallets: Array<{ id: string; walletCurrency: "BTC" | "USD"; balance: number | string }>;
        };
      } | null;
    }>(
      apiKey,
      `query VerifyApiKey {
        authorization { scopes }
        me {
          id
          username
          defaultAccount {
            wallets { id walletCurrency balance }
          }
        }
      }`,
    );

    if (!data.me) {
      throw new AppError(401, "INVALID_BLINK_API_KEY", "Blink did not recognize this API key");
    }

    const scopes = data.authorization.scopes.map((scope) => scope.toUpperCase());
    const missingScopes = ["READ", "WRITE"].filter((required) => !scopes.includes(required));
    if (missingScopes.length > 0) {
      throw new AppError(
        422,
        "INSUFFICIENT_BLINK_PERMISSIONS",
        `Blink API key is missing required ${missingScopes.join(" and ")} permission${missingScopes.length > 1 ? "s" : ""}`,
        { required: ["READ", "WRITE"], received: scopes },
      );
    }

    const wallet = data.me.defaultAccount.wallets.find(
      (candidate) => candidate.walletCurrency === preferredCurrency,
    );
    if (!wallet) {
      throw new AppError(
        422,
        "WALLET_NOT_FOUND",
        `No ${preferredCurrency} wallet is available for this Blink account`,
      );
    }

    return {
      userId: data.me.id,
      username: data.me.username,
      scopes,
      wallet: {
        id: wallet.id,
        currency: wallet.walletCurrency,
        balance: BigInt(wallet.balance),
      },
    };
  }

  async sendPayment(input: {
    apiKey: Buffer;
    method: PaymentMethod;
    senderWalletId: string;
    address: string;
    amount: number;
    memo: string;
  }): Promise<BlinkPaymentResult> {
    return this.withRateLimitRetry(async () => {
      if (input.method === "INTRA_LEDGER") return this.sendIntraLedger(input);
      return this.sendToLightningAddress(input);
    });
  }

  private async sendToLightningAddress(input: {
    apiKey: Buffer;
    senderWalletId: string;
    address: string;
    amount: number;
  }): Promise<BlinkPaymentResult> {
    const data = await this.request<{
      lnAddressPaymentSend: {
        status: string;
        errors: BlinkPayloadError[];
        transaction: { id: string } | null;
      };
    }>(
      input.apiKey,
      `mutation SendToLightningAddress($input: LnAddressPaymentSendInput!) {
        lnAddressPaymentSend(input: $input) {
          status
          errors { code message path }
          transaction { id }
        }
      }`,
      {
        input: {
          walletId: input.senderWalletId,
          lnAddress: input.address,
          amount: input.amount,
        },
      },
    );

    return this.unwrapPayment(data.lnAddressPaymentSend);
  }

  private async sendIntraLedger(input: {
    apiKey: Buffer;
    senderWalletId: string;
    address: string;
    amount: number;
    memo: string;
  }): Promise<BlinkPaymentResult> {
    const username = input.address.split("@")[0];
    if (!username) throw new BlinkApiError("Recipient username is invalid", "INVALID_RECIPIENT");

    const resolved = await this.request<{
      accountDefaultWallet: { id: string } | null;
    }>(
      input.apiKey,
      `query ResolveRecipientWallet($username: Username!, $walletCurrency: WalletCurrency) {
        accountDefaultWallet(username: $username, walletCurrency: $walletCurrency) { id }
      }`,
      { username, walletCurrency: "BTC" },
    );

    if (!resolved.accountDefaultWallet?.id) {
      throw new BlinkApiError(
        "This Rurbit address could not be resolved to a Blink wallet; use Lightning address mode",
        "RECIPIENT_WALLET_NOT_FOUND",
      );
    }

    const data = await this.request<{
      intraLedgerPaymentSend: {
        status: string;
        errors: BlinkPayloadError[];
        transaction: { id: string } | null;
      };
    }>(
      input.apiKey,
      `mutation SendIntraLedger($input: IntraLedgerPaymentSendInput!) {
        intraLedgerPaymentSend(input: $input) {
          status
          errors { code message path }
          transaction { id }
        }
      }`,
      {
        input: {
          walletId: input.senderWalletId,
          recipientWalletId: resolved.accountDefaultWallet.id,
          amount: input.amount,
          memo: input.memo || undefined,
        },
      },
    );

    return this.unwrapPayment(data.intraLedgerPaymentSend);
  }

  private unwrapPayment(payload: {
    status: string;
    errors?: BlinkPayloadError[];
    transaction?: { id: string } | null;
  }): BlinkPaymentResult {
    if (payload.status !== "SUCCESS") {
      const first = payload.errors?.[0];
      throw new BlinkApiError(
        first?.message ?? `Payment finished with status ${payload.status}`,
        first?.code ?? payload.status,
      );
    }

    return { status: payload.status, transactionId: payload.transaction?.id ?? null };
  }

  private async withRateLimitRetry<T>(operation: () => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        if (!(error instanceof BlinkApiError) || error.httpStatus !== 429 || attempt === 2) throw error;
        await sleep(error.retryAfterMs ?? 1_000 * 2 ** attempt);
      }
    }
    throw new BlinkApiError("Blink rate limit retry exhausted", "RATE_LIMITED");
  }
}
