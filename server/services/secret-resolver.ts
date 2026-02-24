import { db } from "../db";
import { integrationSecrets } from "@shared/schema";
import { eq, and, isNull } from "drizzle-orm";
import { decryptSecret, EncryptionMeta } from "./secret-store";

interface GetSecretParams {
  scope: "global" | "tenant";
  tenantId?: string;
  keyName: string;
}

interface CacheEntry {
  value: string | null;
  secretId: string | null;
  rotatedAt: Date | null;
  expiresAt: number;
}

const CACHE_TTL_MS = 60 * 1000;
const MAX_CACHE_SIZE = 500;

const secretCache = new Map<string, CacheEntry>();

function buildCacheKey(params: GetSecretParams): string {
  const tenantPart = params.scope === "tenant" ? params.tenantId || "" : "__global__";
  return `${params.scope}:${tenantPart}:${params.keyName}`;
}

function evictOldestIfNeeded(): void {
  if (secretCache.size >= MAX_CACHE_SIZE) {
    const oldestKey = secretCache.keys().next().value;
    if (oldestKey) {
      secretCache.delete(oldestKey);
    }
  }
}

export async function getSecret(params: GetSecretParams): Promise<string | null> {
  const cacheKey = buildCacheKey(params);
  const now = Date.now();

  const cached = secretCache.get(cacheKey);
  if (cached && cached.expiresAt > now) {
    return cached.value;
  }

  const conditions =
    params.scope === "global"
      ? and(
          eq(integrationSecrets.scope, "global"),
          isNull(integrationSecrets.tenantId),
          eq(integrationSecrets.keyName, params.keyName),
          isNull(integrationSecrets.revokedAt)
        )
      : and(
          eq(integrationSecrets.scope, "tenant"),
          eq(integrationSecrets.tenantId, params.tenantId!),
          eq(integrationSecrets.keyName, params.keyName),
          isNull(integrationSecrets.revokedAt)
        );

  const [secret] = await db
    .select()
    .from(integrationSecrets)
    .where(conditions)
    .limit(1);

  if (!secret) {
    evictOldestIfNeeded();
    secretCache.set(cacheKey, {
      value: null,
      secretId: null,
      rotatedAt: null,
      expiresAt: now + CACHE_TTL_MS,
    });
    return null;
  }

  let plaintext: string;
  try {
    plaintext = decryptSecret(
      secret.encryptedValue,
      secret.encryptionMeta as EncryptionMeta
    );
  } catch (err) {
    console.error("[SecretResolver] Decryption failed for keyName:", params.keyName);
    return null;
  }

  evictOldestIfNeeded();
  secretCache.set(cacheKey, {
    value: plaintext,
    secretId: secret.id,
    rotatedAt: secret.rotatedAt,
    expiresAt: now + CACHE_TTL_MS,
  });

  return plaintext;
}

export function clearSecretCache(params: GetSecretParams): void {
  const cacheKey = buildCacheKey(params);
  secretCache.delete(cacheKey);
}

export function clearAllSecretCache(): void {
  secretCache.clear();
}

export function getSecretCacheSize(): number {
  return secretCache.size;
}
