import pino from "pino";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: {
    paths: [
      "req.headers.x-api-key",
      "req.headers.authorization",
      "req.headers.cookie",
      "req.body.blinkApiKey",
      "blinkApiKey",
      "apiKey",
      "keyCiphertext",
      "keyIv",
      "keyAuthTag",
    ],
    censor: "[REDACTED]",
  },
  ...(process.env.NODE_ENV === "development"
    ? { transport: { target: "pino-pretty", options: { colorize: true, translateTime: "SYS:standard" } } }
    : {}),
});
