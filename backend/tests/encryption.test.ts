import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptApiKey, encryptApiKey } from "../src/encryption.js";

const secret = crypto.randomBytes(32).toString("base64");

describe("API key encryption", () => {
  it("round-trips with AES-256-GCM", () => {
    const plain = Buffer.from("blink_example_secret_key");
    const encrypted = encryptApiKey(plain, secret, "NGO-1234", 1);
    expect(encrypted.ciphertext).not.toContain(plain.toString());
    const decrypted = decryptApiKey(encrypted, secret, "NGO-1234", 1);
    expect(decrypted.toString()).toBe(plain.toString());
    decrypted.fill(0);
  });

  it("rejects tampering", () => {
    const encrypted = encryptApiKey(Buffer.from("blink_secret"), secret, "NGO-1234", 1);
    encrypted.authTag = Buffer.from("tampered-auth-tag").toString("base64");
    expect(() => decryptApiKey(encrypted, secret, "NGO-1234", 1)).toThrow(
      "stored API key could not be decrypted",
    );
  });

  it("binds ciphertext to institution and key version", () => {
    const encrypted = encryptApiKey(Buffer.from("blink_secret"), secret, "NGO-1234", 2);
    expect(() => decryptApiKey(encrypted, secret, "OTHER-NGO", 2)).toThrow();
    expect(() => decryptApiKey(encrypted, secret, "NGO-1234", 3)).toThrow();
  });
});
