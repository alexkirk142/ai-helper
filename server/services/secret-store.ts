import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const KEY_VERSION = 1;

export interface EncryptionMeta {
  iv: string;
  authTag: string;
  version: number;
  alg: string;
}

export interface EncryptedResult {
  ciphertext: string;
  meta: EncryptionMeta;
  last4: string | null;
}

let masterKeyCache: Buffer | null = null;

function getMasterKey(): Buffer {
  if (masterKeyCache) return masterKeyCache;

  const keyEnv = process.env.INTEGRATION_SECRETS_MASTER_KEY;
  if (!keyEnv) {
    throw new Error(
      "INTEGRATION_SECRETS_MASTER_KEY not configured. " +
      "Generate with: openssl rand -base64 32"
    );
  }

  const keyBuffer = Buffer.from(keyEnv, "base64");
  if (keyBuffer.length !== 32) {
    throw new Error(
      `Invalid INTEGRATION_SECRETS_MASTER_KEY length: expected 32 bytes, got ${keyBuffer.length}. ` +
      "Generate with: openssl rand -base64 32"
    );
  }

  masterKeyCache = keyBuffer;
  return keyBuffer;
}

export function validateMasterKey(): { valid: boolean; error?: string } {
  try {
    getMasterKey();
    return { valid: true };
  } catch (err) {
    return { valid: false, error: (err as Error).message };
  }
}

export function encryptSecret(plaintext: string): EncryptedResult {
  const key = getMasterKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  
  const authTag = cipher.getAuthTag();

  const last4 = plaintext.length >= 4 
    ? plaintext.slice(-4) 
    : null;

  return {
    ciphertext: encrypted.toString("base64"),
    meta: {
      iv: iv.toString("base64"),
      authTag: authTag.toString("base64"),
      version: KEY_VERSION,
      alg: ALGORITHM,
    },
    last4,
  };
}

export function decryptSecret(ciphertext: string, meta: EncryptionMeta): string {
  if (meta.version !== KEY_VERSION) {
    throw new Error(
      `Unsupported key version: ${meta.version}. Current version: ${KEY_VERSION}. ` +
      "Key rotation required."
    );
  }

  const key = getMasterKey();
  const iv = Buffer.from(meta.iv, "base64");
  const authTag = Buffer.from(meta.authTag, "base64");
  const encrypted = Buffer.from(ciphertext, "base64");

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, {
    authTagLength: AUTH_TAG_LENGTH,
  });
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([
    decipher.update(encrypted),
    decipher.final(),
  ]);

  return decrypted.toString("utf8");
}

export function clearMasterKeyCache(): void {
  if (masterKeyCache) {
    masterKeyCache.fill(0);
    masterKeyCache = null;
  }
}

const KEY_NAME_PATTERN = /^[A-Z0-9_]{3,64}$/;

export function isValidKeyName(keyName: string): boolean {
  return KEY_NAME_PATTERN.test(keyName);
}
