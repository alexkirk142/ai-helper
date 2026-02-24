/**
 * Encrypt/decrypt Telegram session strings for storage using secret-store (AES-256-GCM).
 * Handles legacy unencrypted session_string values for backward compatibility.
 */

import { encryptSecret, decryptSecret, validateMasterKey, type EncryptionMeta } from "./secret-store";

const ENCRYPTED_PAYLOAD_VERSION = 1;

interface EncryptedPayload {
  v: number;
  ciphertext: string;
  meta: EncryptionMeta;
}

function isEncryptedPayload(stored: string): stored is string {
  if (!stored || typeof stored !== "string") return false;
  if (!stored.startsWith("{")) return false;
  try {
    const o = JSON.parse(stored) as unknown;
    return (
      typeof o === "object" &&
      o !== null &&
      "v" in o &&
      (o as EncryptedPayload).v === ENCRYPTED_PAYLOAD_VERSION &&
      typeof (o as EncryptedPayload).ciphertext === "string" &&
      typeof (o as EncryptedPayload).meta === "object"
    );
  } catch {
    return false;
  }
}

/**
 * Encrypt a session string for DB storage. If master key is not configured,
 * returns the plaintext so callers can store it unencrypted (backward compat).
 */
export function encryptSessionString(plaintext: string): string {
  const { valid } = validateMasterKey();
  if (!valid) {
    return plaintext;
  }
  const { ciphertext, meta } = encryptSecret(plaintext);
  const payload: EncryptedPayload = { v: ENCRYPTED_PAYLOAD_VERSION, ciphertext, meta };
  return JSON.stringify(payload);
}

/**
 * Decrypt a stored session string. Returns plaintext for gramjs.
 * - Legacy unencrypted: returns as-is.
 * - Encrypted: decrypts; on failure (e.g. key rotated) returns null so caller can require re-auth.
 */
export function decryptSessionString(stored: string | null): string | null {
  if (stored == null || stored === "") return null;
  if (!isEncryptedPayload(stored)) {
    return stored;
  }
  try {
    const payload = JSON.parse(stored) as EncryptedPayload;
    return decryptSecret(payload.ciphertext, payload.meta);
  } catch (err) {
    console.error("[TelegramSessionCrypto] Decrypt failed, session may need re-auth:", (err as Error).message);
    return null;
  }
}
