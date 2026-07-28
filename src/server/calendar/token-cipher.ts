import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Authenticated ciphertext for a Google refresh token at rest. Only these four
 * fields are ever persisted; the plaintext token never touches the database, a
 * response body, or a log line. `keyVersion` records which key sealed the value
 * so keys can rotate without a bulk re-encryption.
 */
export interface EncryptedToken {
  ciphertext: string;
  nonce: string;
  authTag: string;
  keyVersion: number;
}

/**
 * The set of AES-256 keys this process can read, plus the version new writes
 * are sealed under. Older versions remain present so previously stored tokens
 * stay decryptable across a rotation.
 */
export interface TokenKeyring {
  currentVersion: number;
  keys: Map<number, Buffer>;
}

const ALGORITHM = "aes-256-gcm";
const NONCE_BYTES = 12;

function keyFor(keyring: TokenKeyring, version: number): Buffer {
  const key = keyring.keys.get(version);
  if (!key) {
    throw new Error(`No calendar token key for key version ${version}.`);
  }
  if (key.byteLength !== 32) {
    throw new Error(
      `Calendar token key version ${version} must be 32 bytes for AES-256.`,
    );
  }
  return key;
}

/**
 * Builds an AES-256-GCM cipher over a keyring. `encrypt` seals a refresh token
 * under the current key version; `decrypt` reads any version still in the
 * keyring and throws if the ciphertext, nonce, or auth tag was altered (GCM
 * authentication) or the key version is unknown.
 */
export function createTokenCipher(keyring: TokenKeyring) {
  const currentKey = keyFor(keyring, keyring.currentVersion);

  return {
    encrypt(plaintext: string): EncryptedToken {
      const nonce = randomBytes(NONCE_BYTES);
      const cipher = createCipheriv(ALGORITHM, currentKey, nonce);
      const ciphertext = Buffer.concat([
        cipher.update(plaintext, "utf8"),
        cipher.final(),
      ]);

      return {
        ciphertext: ciphertext.toString("base64"),
        nonce: nonce.toString("base64"),
        authTag: cipher.getAuthTag().toString("base64"),
        keyVersion: keyring.currentVersion,
      };
    },

    decrypt(token: EncryptedToken): string {
      const key = keyFor(keyring, token.keyVersion);
      const decipher = createDecipheriv(
        ALGORITHM,
        key,
        Buffer.from(token.nonce, "base64"),
      );
      decipher.setAuthTag(Buffer.from(token.authTag, "base64"));

      const plaintext = Buffer.concat([
        decipher.update(Buffer.from(token.ciphertext, "base64")),
        decipher.final(),
      ]);

      return plaintext.toString("utf8");
    },
  };
}

export type TokenCipher = ReturnType<typeof createTokenCipher>;
