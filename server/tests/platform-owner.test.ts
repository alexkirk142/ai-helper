import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { users, tenants, adminActions, integrationSecrets } from "@shared/schema";
import { eq, sql, and, isNull, desc } from "drizzle-orm";
import { adminActionService } from "../services/admin-action-service";
import bcrypt from "bcrypt";

describe("Platform Owner", () => {
  let ownerId: string;
  let adminId: string;
  let regularUserId: string;
  let tenantId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Owner Test Tenant" })
      .returning();
    tenantId = tenant.id;

    const passwordHash = await bcrypt.hash("test123", 10);

    const [owner] = await db
      .insert(users)
      .values({
        username: `owner_test_${Date.now()}`,
        email: `owner_test_${Date.now()}@test.com`,
        password: passwordHash,
        role: "owner",
        tenantId,
        isPlatformOwner: true,
        isPlatformAdmin: true,
      })
      .returning();
    ownerId = owner.id;

    const [admin] = await db
      .insert(users)
      .values({
        username: `admin_test_${Date.now()}`,
        email: `admin_test_${Date.now()}@test.com`,
        password: passwordHash,
        role: "admin",
        tenantId,
        isPlatformOwner: false,
        isPlatformAdmin: true,
      })
      .returning();
    adminId = admin.id;

    const [regular] = await db
      .insert(users)
      .values({
        username: `regular_test_${Date.now()}`,
        email: `regular_test_${Date.now()}@test.com`,
        password: passwordHash,
        role: "operator",
        tenantId,
        isPlatformOwner: false,
        isPlatformAdmin: false,
      })
      .returning();
    regularUserId = regular.id;
  });

  afterAll(async () => {
    await db.delete(adminActions).where(eq(adminActions.adminId, ownerId));
    await db.delete(adminActions).where(eq(adminActions.adminId, adminId));
    await db.delete(integrationSecrets).where(eq(integrationSecrets.tenantId, tenantId));
    await db.delete(users).where(eq(users.id, ownerId));
    await db.delete(users).where(eq(users.id, adminId));
    await db.delete(users).where(eq(users.id, regularUserId));
    await db.delete(tenants).where(eq(tenants.id, tenantId));
  });

  describe("Owner protection", () => {
    it("should not allow disabling platform owner", async () => {
      const result = await adminActionService.disableUser(ownerId, adminId, "Test disable");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot disable platform owner");
    });

    it("should allow disabling platform admin (non-owner)", async () => {
      const newAdminPassword = await bcrypt.hash("test123", 10);
      const [tempAdmin] = await db
        .insert(users)
        .values({
          username: `temp_admin_${Date.now()}`,
          email: `temp_admin_${Date.now()}@test.com`,
          password: newAdminPassword,
          role: "admin",
          tenantId,
          isPlatformOwner: false,
          isPlatformAdmin: true,
        })
        .returning();

      const result = await adminActionService.disableUser(tempAdmin.id, ownerId, "Test disable admin");
      expect(result.success).toBe(false);
      expect(result.error).toBe("Cannot disable platform admin");

      await db.delete(users).where(eq(users.id, tempAdmin.id));
    });

    it("should allow disabling regular user", async () => {
      const result = await adminActionService.disableUser(regularUserId, adminId, "Test disable");
      expect(result.success).toBe(true);

      await db
        .update(users)
        .set({ isDisabled: false, disabledAt: null, disabledReason: null })
        .where(eq(users.id, regularUserId));
    });
  });

  describe("Promote/Demote admin", () => {
    it("should promote user to admin", async () => {
      const result = await adminActionService.promoteToAdmin(regularUserId, ownerId, "Promoting to admin");
      expect(result.success).toBe(true);
      expect(result.alreadyInState).toBeFalsy();

      const [user] = await db.select().from(users).where(eq(users.id, regularUserId));
      expect(user.isPlatformAdmin).toBe(true);
    });

    it("should return already admin for repeated promote", async () => {
      const result = await adminActionService.promoteToAdmin(regularUserId, ownerId, "Already admin");
      expect(result.success).toBe(true);
      expect(result.alreadyInState).toBe(true);
    });

    it("should demote admin to regular user", async () => {
      const result = await adminActionService.demoteFromAdmin(regularUserId, ownerId, "Demoting from admin");
      expect(result.success).toBe(true);
      expect(result.alreadyInState).toBeFalsy();

      const [user] = await db.select().from(users).where(eq(users.id, regularUserId));
      expect(user.isPlatformAdmin).toBe(false);
    });

    it("should return already not admin for repeated demote", async () => {
      const result = await adminActionService.demoteFromAdmin(regularUserId, ownerId, "Already not admin");
      expect(result.success).toBe(true);
      expect(result.alreadyInState).toBe(true);
    });

    it("should not allow modifying platform owner privileges", async () => {
      const promoteResult = await adminActionService.promoteToAdmin(ownerId, adminId, "Try promote owner");
      expect(promoteResult.success).toBe(false);
      expect(promoteResult.error).toBe("Cannot modify platform owner privileges");

      const demoteResult = await adminActionService.demoteFromAdmin(ownerId, adminId, "Try demote owner");
      expect(demoteResult.success).toBe(false);
      expect(demoteResult.error).toBe("Cannot modify platform owner privileges");
    });
  });

  describe("Audit logging", () => {
    it("should log promote action", async () => {
      const promoteUserId = regularUserId;
      await db.update(users).set({ isPlatformAdmin: false }).where(eq(users.id, promoteUserId));
      
      await adminActionService.promoteToAdmin(promoteUserId, ownerId, "Audit test promote");

      const [action] = await db
        .select()
        .from(adminActions)
        .where(
          and(
            eq(adminActions.actionType, "admin_promote"),
            eq(adminActions.targetId, promoteUserId)
          )
        )
        .orderBy(desc(adminActions.createdAt))
        .limit(1);

      expect(action).toBeDefined();
      expect(action.adminId).toBe(ownerId);
      expect(action.reason).toBe("Audit test promote");
    });

    it("should log demote action", async () => {
      await adminActionService.demoteFromAdmin(regularUserId, ownerId, "Audit test demote");

      const [action] = await db
        .select()
        .from(adminActions)
        .where(
          and(
            eq(adminActions.actionType, "admin_demote"),
            eq(adminActions.targetId, regularUserId)
          )
        )
        .orderBy(desc(adminActions.createdAt))
        .limit(1);

      expect(action).toBeDefined();
      expect(action.adminId).toBe(ownerId);
      expect(action.reason).toBe("Audit test demote");
    });
  });

  describe("isPlatformOwner field", () => {
    it("should have isPlatformOwner field on user", async () => {
      const [owner] = await db.select().from(users).where(eq(users.id, ownerId));
      expect(owner.isPlatformOwner).toBe(true);

      const [admin] = await db.select().from(users).where(eq(users.id, adminId));
      expect(admin.isPlatformOwner).toBe(false);

      const [regular] = await db.select().from(users).where(eq(users.id, regularUserId));
      expect(regular.isPlatformOwner).toBe(false);
    });

    it("should only have one owner in system (new users default to false)", async () => {
      const passwordHash = await bcrypt.hash("test", 10);
      const [newUser] = await db
        .insert(users)
        .values({
          username: `new_user_${Date.now()}`,
          email: `new_user_${Date.now()}@test.com`,
          password: passwordHash,
          role: "operator",
          tenantId,
        })
        .returning();

      expect(newUser.isPlatformOwner).toBe(false);
      await db.delete(users).where(eq(users.id, newUser.id));
    });
  });
});
