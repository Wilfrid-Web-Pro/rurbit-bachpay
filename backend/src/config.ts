import { z } from "zod";

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  ENCRYPTION_SECRET: z.string().min(1),
  FRONTEND_ORIGIN: z.string().url().default("http://localhost:5173"),
  BLINK_GRAPHQL_URL: z.string().url().default("https://api.blink.sv/graphql"),
  DEFAULT_WALLET_CURRENCY: z.enum(["BTC", "USD"]).default("BTC"),
  PAYMENT_DELAY_MS: z.coerce.number().int().min(0).max(60_000).default(2_000),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(8),
  MAX_BATCH_RECIPIENTS: z.coerce.number().int().min(1).max(5_000).default(500),
});

export type AppConfig = z.infer<typeof envSchema>;

let cached: AppConfig | undefined;

export function getConfig(): AppConfig {
  cached ??= envSchema.parse(process.env);
  return cached;
}
