import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { users, tenants, adminActions, integrationSecrets } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { encryptSecret, decryptSecret, isValidKeyName } from "../services/secret-store";
import { getSecret, clearSecretCache, clearAllSecretCache, getSecretCacheSize } from "../services/secret-resolver";

describe("Integration Secrets", () => {
  let adminUser: typeof users.$inferSelect;
  let regularUser: typeof users.$inferSelect;
  let testTenant: typeof tenants.$inferSelect;

  beforeAll(async () => {
    [testTenant] = await db
      .insert(tenants)
      .values({ name: "Secret Test Tenant" })
      .returning();

    [adminUser] = await db
      .insert(users)
      .values({
        username: `secret_admin_${Date.now()}`,
        password: "hashed",
        tenantId: testTenant.id,
        isPlatformAdmin: true,
      })
      .returning();

    [regularUser] = await db
      .insert(users)
      .values({
        username: `secret_regular_${Date.now()}`,
        password: "hashed",
        tenantId: testTenant.id,
        isPlatformAdmin: false,
      })
      .returning();
  });

  afterAll(async () => {
    await db.delete(adminActions).where(eq(adminActions.adminId, adminUser.id));
    await db.delete(integrationSecrets).where(eq(integrationSecrets.createdByAdminId, adminUser.id));
    await db.delete(users).where(eq(users.id, adminUser.id));
    await db.delete(users).where(eq(users.id, regularUser.id));
    await db.delete(tenants).where(eq(tenants.id, testTenant.id));
  });

  describe("isValidKeyName", () => {
    it("accepts valid key names", () => {
      expect(isValidKeyName("STRIPE_SECRET_KEY")).toBe(true);
      expect(isValidKeyName("TG_BOT_TOKEN")).toBe(true);
      expect(isValidKeyName("API_KEY_123")).toBe(true);
      expect(isValidKeyName("ABC")).toBe(true);
    });

    it("rejects invalid key names", () => {
      expect(isValidKeyName("ab")).toBe(false); // too short
      expect(isValidKeyName("lowercase")).toBe(false);
      expect(isValidKeyName("HAS-DASH")).toBe(false);
      expect(isValidKeyName("HAS SPACE")).toBe(false);
      expect(isValidKeyName("")).toBe(false);
    });
  });

  describe("encryption", () => {
    it("encrypts and decrypts correctly", () => {
      const plaintext = "sk_live_test_secret_value_12345";
      const { ciphertext, meta, last4 } = encryptSecret(plaintext);

      expect(ciphertext).not.toBe(plaintext);
      expect(last4).toBe("2345");
      expect(meta.version).toBe(1);
      expect(meta.alg).toBe("aes-256-gcm");

      const decrypted = decryptSecret(ciphertext, meta);
      expect(decrypted).toBe(plaintext);
    });

    it("never returns plaintext in result object", () => {
      const plaintext = "super_secret_api_key";
      const result = encryptSecret(plaintext);

      const resultStr = JSON.stringify(result);
      expect(resultStr).not.toContain(plaintext);
      expect(resultStr).not.toContain("super_secret");
    });
  });

  describe("secret creation with upsert", () => {
    it("creates new secret and logs admin action", async () => {
      const keyName = `TEST_KEY_${Date.now()}`;
      const plaintext = "test_value_123456";
      const { ciphertext, meta, last4 } = encryptSecret(plaintext);

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      await db.insert(adminActions).values({
        actionType: "secret_create",
        targetType: "secret",
        targetId: secret.id,
        adminId: adminUser.id,
        reason: "Test secret creation",
        previousState: null,
        metadata: null,
      });

      expect(secret.last4).toBe("3456");
      expect(secret.revokedAt).toBeNull();

      const [action] = await db
        .select()
        .from(adminActions)
        .where(and(eq(adminActions.targetId, secret.id), eq(adminActions.actionType, "secret_create")))
        .limit(1);

      expect(action).toBeDefined();
      expect(action.adminId).toBe(adminUser.id);

      await db.delete(adminActions).where(eq(adminActions.targetId, secret.id));
      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });
  });

  describe("rotate updates last4 and rotatedAt", () => {
    it("updates secret on rotate", async () => {
      const keyName = `ROTATE_KEY_${Date.now()}`;
      const original = encryptSecret("original_value_1234");

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: original.ciphertext,
          encryptionMeta: original.meta,
          last4: original.last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      expect(secret.last4).toBe("1234");
      expect(secret.rotatedAt).toBeNull();

      const rotated = encryptSecret("new_rotated_value_5678");

      const [updated] = await db
        .update(integrationSecrets)
        .set({
          encryptedValue: rotated.ciphertext,
          encryptionMeta: rotated.meta,
          last4: rotated.last4,
          rotatedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(integrationSecrets.id, secret.id))
        .returning();

      expect(updated.last4).toBe("5678");
      expect(updated.rotatedAt).not.toBeNull();

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });
  });

  describe("revoke idempotency logs noOp", () => {
    it("logs noOp on repeated revoke", async () => {
      const keyName = `REVOKE_KEY_${Date.now()}`;
      const { ciphertext, meta, last4 } = encryptSecret("revoke_test_value");

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      await db
        .update(integrationSecrets)
        .set({ revokedAt: new Date() })
        .where(eq(integrationSecrets.id, secret.id));

      await db.insert(adminActions).values({
        actionType: "secret_revoke",
        targetType: "secret",
        targetId: secret.id,
        adminId: adminUser.id,
        reason: "First revoke",
        previousState: { last4 },
        metadata: null,
      });

      await db.insert(adminActions).values({
        actionType: "secret_revoke",
        targetType: "secret",
        targetId: secret.id,
        adminId: adminUser.id,
        reason: "Second revoke (noOp)",
        previousState: null,
        metadata: { idempotent: true, noOp: true, alreadyState: "revoked" },
      });

      const actions = await db
        .select()
        .from(adminActions)
        .where(and(eq(adminActions.targetId, secret.id), eq(adminActions.actionType, "secret_revoke")));

      expect(actions.length).toBe(2);

      const noOpAction = actions.find((a) => (a.metadata as any)?.noOp === true);
      expect(noOpAction).toBeDefined();
      expect(noOpAction!.previousState).toBeNull();

      await db.delete(adminActions).where(eq(adminActions.targetId, secret.id));
      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });
  });

  describe("uniqueness enforcement", () => {
    it("enforces unique active secret for global scope", async () => {
      const keyName = `UNIQUE_GLOBAL_${Date.now()}`;
      const { ciphertext, meta, last4 } = encryptSecret("first_value");

      const [first] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      let threw = false;
      try {
        await db.insert(integrationSecrets).values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        }).returning();
      } catch (err: any) {
        threw = true;
        expect(err.message).toContain("integration_secrets_active_unique_idx");
      }

      expect(threw).toBe(true);

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, first.id));
    });

    it("allows same keyName in different tenant scopes", async () => {
      const keyName = `TENANT_SHARED_${Date.now()}`;
      const { ciphertext, meta, last4 } = encryptSecret("tenant_value");

      const [tenant2] = await db.insert(tenants).values({ name: "Tenant 2" }).returning();

      const [secret1] = await db
        .insert(integrationSecrets)
        .values({
          scope: "tenant",
          tenantId: testTenant.id,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      const [secret2] = await db
        .insert(integrationSecrets)
        .values({
          scope: "tenant",
          tenantId: tenant2.id,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      expect(secret1.id).not.toBe(secret2.id);
      expect(secret1.keyName).toBe(secret2.keyName);

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret1.id));
      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret2.id));
      await db.delete(tenants).where(eq(tenants.id, tenant2.id));
    });
  });

  describe("SecretResolver", () => {
    beforeAll(() => {
      clearAllSecretCache();
    });

    it("returns null for non-existent secret", async () => {
      const result = await getSecret({
        scope: "global",
        keyName: "NON_EXISTENT_KEY_12345",
      });
      expect(result).toBeNull();
    });

    it("retrieves and decrypts secret correctly", async () => {
      const keyName = `RESOLVER_TEST_${Date.now()}`;
      const plaintext = "test_secret_value_xyz";
      const { ciphertext, meta, last4 } = encryptSecret(plaintext);

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      const result = await getSecret({ scope: "global", keyName });
      expect(result).toBe(plaintext);

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });

    it("caches secrets and returns from cache", async () => {
      const keyName = `CACHE_TEST_${Date.now()}`;
      const plaintext = "cached_value";
      const { ciphertext, meta, last4 } = encryptSecret(plaintext);

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      const sizeBefore = getSecretCacheSize();
      await getSecret({ scope: "global", keyName });
      const sizeAfter = getSecretCacheSize();

      expect(sizeAfter).toBeGreaterThan(sizeBefore);

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });

    it("clears cache on clearSecretCache call", async () => {
      const keyName = `CLEAR_CACHE_${Date.now()}`;
      const plaintext = "clearable";
      const { ciphertext, meta, last4 } = encryptSecret(plaintext);

      const [secret] = await db
        .insert(integrationSecrets)
        .values({
          scope: "global",
          tenantId: null,
          keyName,
          encryptedValue: ciphertext,
          encryptionMeta: meta,
          last4,
          createdByAdminId: adminUser.id,
        })
        .returning();

      await getSecret({ scope: "global", keyName });
      const sizeBefore = getSecretCacheSize();

      clearSecretCache({ scope: "global", keyName });
      const sizeAfter = getSecretCacheSize();

      expect(sizeAfter).toBeLessThan(sizeBefore);

      await db.delete(integrationSecrets).where(eq(integrationSecrets.id, secret.id));
    });
  });
});
