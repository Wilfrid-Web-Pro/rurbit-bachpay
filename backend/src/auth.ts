import crypto from "node:crypto";
import type { CookieOptions, NextFunction, Request, Response } from "express";
import { prisma } from "./db.js";
import { AppError } from "./errors.js";
import { getConfig } from "./config.js";

export const SESSION_COOKIE = "rurbit_session";

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

function cookieOptions(): CookieOptions {
  const config = getConfig();
  return {
    httpOnly: true,
    secure: config.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: config.SESSION_TTL_HOURS * 60 * 60 * 1_000,
  };
}

export async function createSession(institutionId: string, response: Response): Promise<void> {
  const config = getConfig();
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + config.SESSION_TTL_HOURS * 60 * 60 * 1_000);

  await prisma.session.create({
    data: { tokenHash: hashToken(token), institutionId, expiresAt },
  });
  response.cookie(SESSION_COOKIE, token, cookieOptions());
}

export async function destroySession(request: Request, response: Response): Promise<void> {
  const token = request.cookies[SESSION_COOKIE] as string | undefined;
  if (token) await prisma.session.deleteMany({ where: { tokenHash: hashToken(token) } });
  response.clearCookie(SESSION_COOKIE, { ...cookieOptions(), maxAge: undefined });
}

export async function requireSession(request: Request, _response: Response, next: NextFunction): Promise<void> {
  try {
    const token = request.cookies[SESSION_COOKIE] as string | undefined;
    if (!token) throw new AppError(401, "AUTHENTICATION_REQUIRED", "Sign in with a Blink API key to continue");

    const session = await prisma.session.findUnique({
      where: { tokenHash: hashToken(token) },
      include: { institution: true },
    });
    if (!session || session.expiresAt <= new Date()) {
      if (session) await prisma.session.delete({ where: { id: session.id } });
      throw new AppError(401, "SESSION_EXPIRED", "Your session has expired; sign in again");
    }

    request.institution = session.institution;
    request.sessionId = session.id;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireOwnInstitution(request: Request, _response: Response, next: NextFunction): void {
  if (!request.institution || request.institution.id !== request.params.id) {
    next(new AppError(403, "FORBIDDEN", "You cannot access this institution"));
    return;
  }
  next();
}

export function enforceProductionOrigin(request: Request, _response: Response, next: NextFunction): void {
  const config = getConfig();
  if (config.NODE_ENV !== "production" || ["GET", "HEAD", "OPTIONS"].includes(request.method)) {
    next();
    return;
  }

  const origin = request.get("origin");
  if (origin !== config.FRONTEND_ORIGIN) {
    next(new AppError(403, "INVALID_ORIGIN", "Request origin is not allowed"));
    return;
  }
  next();
}
