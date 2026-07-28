import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";

import { createTokenCipher, type TokenKeyring } from "./token-cipher";

function keyring(overrides: Partial<TokenKeyring> = {}): TokenKeyring {
  const keys = new Map<number, Buffer>([[1, randomBytes(32)]]);
  return { currentVersion: 1, keys, ...overrides };
}

describe("token cipher", () => {
  it("round-trips a refresh token through encryption", () => {
    const cipher = createTokenCipher(keyring());
    const plaintext = "1//refresh-token-value";

    const encrypted = cipher.encrypt(plaintext);

    expect(encrypted.ciphertext).not.toContain(plaintext);
    expect(cipher.decrypt(encrypted)).toBe(plaintext);
  });

  it("stamps the current key version onto the ciphertext", () => {
    const keys = new Map<number, Buffer>([
      [1, randomBytes(32)],
      [2, randomBytes(32)],
    ]);
    const cipher = createTokenCipher({ currentVersion: 2, keys });

    expect(cipher.encrypt("token").keyVersion).toBe(2);
  });

  it("decrypts ciphertext written under an older key version", () => {
    const keys = new Map<number, Buffer>([
      [1, randomBytes(32)],
      [2, randomBytes(32)],
    ]);
    const writer = createTokenCipher({ currentVersion: 1, keys });
    const encrypted = writer.encrypt("legacy");

    // A cipher whose current version has rotated forward can still read v1.
    const reader = createTokenCipher({ currentVersion: 2, keys });
    expect(reader.decrypt(encrypted)).toBe("legacy");
  });

  it("uses a fresh nonce per encryption so equal plaintexts differ", () => {
    const cipher = createTokenCipher(keyring());

    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");

    expect(a.nonce).not.toBe(b.nonce);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it("rejects a tampered ciphertext instead of returning wrong plaintext", () => {
    const cipher = createTokenCipher(keyring());
    const encrypted = cipher.encrypt("token");

    const tampered = {
      ...encrypted,
      ciphertext: Buffer.from("not-the-real-bytes").toString("base64"),
    };

    expect(() => cipher.decrypt(tampered)).toThrow();
  });

  it("rejects a ciphertext whose auth tag was altered", () => {
    const cipher = createTokenCipher(keyring());
    const encrypted = cipher.encrypt("token");
    const forgedTag = Buffer.alloc(16, 0).toString("base64");

    expect(() =>
      cipher.decrypt({ ...encrypted, authTag: forgedTag }),
    ).toThrow();
  });

  it("fails when the key version is unknown to the keyring", () => {
    const cipher = createTokenCipher(keyring());
    const encrypted = cipher.encrypt("token");

    expect(() => cipher.decrypt({ ...encrypted, keyVersion: 99 })).toThrow(
      /key version/i,
    );
  });

  it("cannot decrypt with a different key", () => {
    const encrypted = createTokenCipher(keyring()).encrypt("token");
    const other = createTokenCipher(keyring());

    expect(() => other.decrypt(encrypted)).toThrow();
  });
});
