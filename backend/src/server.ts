import path from "node:path";
import { fileURLToPath } from "node:url";
import cookieParser from "cookie-parser";
import cors from "cors";
import express, { type NextFunction, type Request, type Response } from "express";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { pinoHttp } from "pino-http";
import { Prisma } from "@prisma/client";
import { ZodError } from "zod";
import { enforceProductionOrigin } from "./auth.js";
import { recoverInterruptedBatches } from "./batch-runner.js";
import { getConfig } from "./config.js";
import { CsvValidationError } from "./csv-parser.js";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { logger } from "./logger.js";
import { apiRouter } from "./routes.js";

const config = getConfig();
const app = express();

app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(
  pinoHttp({
    logger,
    customLogLevel: (_request, response, error) => {
      if (error || response.statusCode >= 500) return "error";
      if (response.statusCode >= 400) return "warn";
      return "info";
    },
  }),
);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", "data:"],
        connectSrc: ["'self'"],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: "no-referrer" },
  }),
);
app.use(
  cors({
    origin: config.NODE_ENV === "development" ? config.FRONTEND_ORIGIN : false,
    credentials: true,
  }),
);
app.use(express.json({ limit: "1100kb" }));
app.use(cookieParser());
app.use(enforceProductionOrigin);
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  }),
  apiRouter,
);

if (config.NODE_ENV === "production") {
  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const frontendDist = path.resolve(currentDir, "../../frontend/dist");
  app.use(express.static(frontendDist, { index: false, maxAge: "1d" }));
  app.get(/.*/, (_request, response) => response.sendFile(path.join(frontendDist, "index.html")));
}

app.use((error: unknown, request: Request, response: Response, _next: NextFunction) => {
  if (error instanceof CsvValidationError) {
    response.status(422).json({ error: { code: "INVALID_CSV", message: error.message, details: error.issues } });
    return;
  }
  if (error instanceof ZodError) {
    response.status(400).json({
      error: {
        code: "INVALID_REQUEST",
        message: "Check the submitted fields",
        details: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
      },
    });
    return;
  }
  if (error instanceof AppError) {
    response.status(error.statusCode).json({
      error: { code: error.code, message: error.message, ...(error.details ? { details: error.details } : {}) },
    });
    return;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
    response.status(409).json({ error: { code: "CONFLICT", message: "That record already exists" } });
    return;
  }
  if (error instanceof SyntaxError && "body" in error) {
    response.status(400).json({ error: { code: "INVALID_JSON", message: "Request body is not valid JSON" } });
    return;
  }

  request.log.error({ err: error }, "Unhandled request error");
  response.status(500).json({ error: { code: "INTERNAL_ERROR", message: "An unexpected error occurred" } });
});

const server = app.listen(config.PORT, "0.0.0.0", () => {
  logger.info({ port: config.PORT, environment: config.NODE_ENV }, "Rurbit API listening");
});

void recoverInterruptedBatches().catch((error: unknown) => {
  logger.fatal({ err: error }, "Startup recovery failed");
  server.close(() => process.exit(1));
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, "Shutting down");
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));
