import crypto from "node:crypto";
import { AppError } from "./errors.js";

export interface EncryptedSecret {
  ciphertext: string;
  iv: string;
  authTag: string;
}

export function parseMasterKey(encoded: string): Buffer {
  const value = encoded.trim();
  let key: Buffer;

  if (/^[a-f\d]{64}$/i.test(value)) {
    key = Buffer.from(value, "hex");
  } else {
    key = Buffer.from(value, "base64");
  }

  if (key.length !== 32) {
    key.fill(0);
    throw new AppError(
      500,
      "INVALID_ENCRYPTION_SECRET",
      "ENCRYPTION_SECRET must be exactly 32 bytes encoded as base64 or 64 hex characters",
    );
  }

  return key;
}

function additionalData(institutionId: string, version: number): Buffer {
  return Buffer.from(`rurbit-api-key:${institutionId}:v${version}`, "utf8");
}

export function encryptApiKey(
  apiKey: Buffer,
  encodedMasterKey: string,
  institutionId: string,
  version: number,
): EncryptedSecret {
  const masterKey = parseMasterKey(encodedMasterKey);
  const iv = crypto.randomBytes(12);

  try {
    const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv, { authTagLength: 16 });
    cipher.setAAD(additionalData(institutionId, version));
    const ciphertext = Buffer.concat([cipher.update(apiKey), cipher.final()]);
    const authTag = cipher.getAuthTag();

    return {
      ciphertext: ciphertext.toString("base64"),
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
    };
  } finally {
    masterKey.fill(0);
  }
}

export function decryptApiKey(
  secret: EncryptedSecret,
  encodedMasterKey: string,
  institutionId: string,
  version: number,
): Buffer {
  const masterKey = parseMasterKey(encodedMasterKey);
  const iv = Buffer.from(secret.iv, "base64");
  const authTag = Buffer.from(secret.authTag, "base64");
  const ciphertext = Buffer.from(secret.ciphertext, "base64");

  try {
    if (iv.length !== 12 || authTag.length !== 16) {
      throw new Error("Invalid encrypted key metadata");
    }

    const decipher = crypto.createDecipheriv("aes-256-gcm", masterKey, iv, {
      authTagLength: 16,
    });
    decipher.setAAD(additionalData(institutionId, version));
    decipher.setAuthTag(authTag);
    return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  } catch {
    throw new AppError(500, "KEY_DECRYPTION_FAILED", "The stored API key could not be decrypted");
  } finally {
    masterKey.fill(0);
    ciphertext.fill(0);
  }
}
