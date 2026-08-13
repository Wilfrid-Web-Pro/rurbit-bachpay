import type { Institution } from "@prisma/client";

declare global {
  namespace Express {
    interface Request {
      institution?: Institution;
      sessionId?: string;
    }
  }
}

export {};
