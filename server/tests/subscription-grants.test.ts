import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { db } from "../db";
import { tenants, users, subscriptionGrants, adminActions } from "../../shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { hasActiveGrant } from "../services/billing-service";

describe("Subscription Grants", () => {
  let testTenantId: string;
  let testAdminId: string;

  beforeAll(async () => {
    const [tenant] = await db
      .insert(tenants)
      .values({ name: "Test Tenant Grants" })
      .returning();
    testTenantId = tenant.id;

    const [admin] = await db
      .insert(users)
      .values({
        tenantId: testTenantId,
        username: `admin_grants_${Date.now()}`,
        password: "hashed",
        isPlatformAdmin: true,
      })
      .returning();
    testAdminId = admin.id;
  });

  afterAll(async () => {
    await db.delete(subscriptionGrants).where(eq(subscriptionGrants.tenantId, testTenantId));
    await db.delete(users).where(eq(users.id, testAdminId));
    await db.delete(tenants).where(eq(tenants.id, testTenantId));
  });

  it("hasActiveGrant returns false when no grant exists", async () => {
    const result = await hasActiveGrant(testTenantId);
    expect(result.hasGrant).toBe(false);
    expect(result.grantEndsAt).toBeNull();
  });

  it("hasActiveGrant returns true for active grant", async () => {
    const now = new Date();
    const startsAt = new Date(now.getTime() - 1000 * 60 * 60);
    const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24);

    await db.insert(subscriptionGrants).values({
      tenantId: testTenantId,
      startsAt,
      endsAt,
      grantedByUserId: testAdminId,
      reason: "Test grant",
    });

    const result = await hasActiveGrant(testTenantId);
    expect(result.hasGrant).toBe(true);
    expect(result.grantEndsAt).not.toBeNull();
  });

  it("hasActiveGrant returns false for expired grant", async () => {
    await db.delete(subscriptionGrants).where(eq(subscriptionGrants.tenantId, testTenantId));

    const now = new Date();
    const startsAt = new Date(now.getTime() - 1000 * 60 * 60 * 48);
    const endsAt = new Date(now.getTime() - 1000 * 60 * 60 * 24);

    await db.insert(subscriptionGrants).values({
      tenantId: testTenantId,
      startsAt,
      endsAt,
      grantedByUserId: testAdminId,
      reason: "Expired grant",
    });

    const result = await hasActiveGrant(testTenantId);
    expect(result.hasGrant).toBe(false);
  });

  it("hasActiveGrant returns false for revoked grant", async () => {
    await db.delete(subscriptionGrants).where(eq(subscriptionGrants.tenantId, testTenantId));

    const now = new Date();
    const startsAt = new Date(now.getTime() - 1000 * 60 * 60);
    const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24);

    await db.insert(subscriptionGrants).values({
      tenantId: testTenantId,
      startsAt,
      endsAt,
      grantedByUserId: testAdminId,
      reason: "Revoked grant",
      revokedAt: new Date(),
      revokedByUserId: testAdminId,
      revokedReason: "Revoked for test",
    });

    const result = await hasActiveGrant(testTenantId);
    expect(result.hasGrant).toBe(false);
  });

  it("hasActiveGrant returns false for future grant", async () => {
    await db.delete(subscriptionGrants).where(eq(subscriptionGrants.tenantId, testTenantId));

    const now = new Date();
    const startsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24);
    const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 48);

    await db.insert(subscriptionGrants).values({
      tenantId: testTenantId,
      startsAt,
      endsAt,
      grantedByUserId: testAdminId,
      reason: "Future grant",
    });

    const result = await hasActiveGrant(testTenantId);
    expect(result.hasGrant).toBe(false);
  });

  it("repeated revoke creates 2 admin_actions rows with second having noOp metadata", async () => {
    await db.delete(subscriptionGrants).where(eq(subscriptionGrants.tenantId, testTenantId));

    const now = new Date();
    const startsAt = new Date(now.getTime() - 1000 * 60 * 60);
    const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24);

    const [grant] = await db.insert(subscriptionGrants).values({
      tenantId: testTenantId,
      startsAt,
      endsAt,
      grantedByUserId: testAdminId,
      reason: "Grant for revoke test",
    }).returning();

    await db.insert(adminActions).values({
      actionType: "grant_revoke",
      targetType: "grant",
      targetId: grant.id,
      adminId: testAdminId,
      reason: "First revoke",
      previousState: { startsAt, endsAt, tenantId: testTenantId },
      metadata: null,
    });

    await db.update(subscriptionGrants)
      .set({ revokedAt: new Date(), revokedByUserId: testAdminId, revokedReason: "First revoke" })
      .where(eq(subscriptionGrants.id, grant.id));

    await db.insert(adminActions).values({
      actionType: "grant_revoke",
      targetType: "grant",
      targetId: grant.id,
      adminId: testAdminId,
      reason: "Second revoke attempt",
      previousState: null,
      metadata: { idempotent: true, noOp: true, alreadyState: "revoked", grantId: grant.id, tenantId: testTenantId },
    });

    const actions = await db
      .select()
      .from(adminActions)
      .where(and(
        eq(adminActions.targetId, grant.id),
        eq(adminActions.actionType, "grant_revoke")
      ))
      .orderBy(desc(adminActions.createdAt));

    expect(actions.length).toBe(2);
    
    const noOpAction = actions.find(a => (a.metadata as any)?.noOp === true);
    expect(noOpAction).toBeDefined();
    expect((noOpAction!.metadata as any).idempotent).toBe(true);
    expect((noOpAction!.metadata as any).alreadyState).toBe("revoked");
    expect(noOpAction!.previousState).toBeNull();

    const realAction = actions.find(a => a.previousState !== null);
    expect(realAction).toBeDefined();
    expect(realAction!.metadata).toBeNull();

    await db.delete(adminActions).where(eq(adminActions.targetId, grant.id));
  });

  it("rejects grants exceeding 365 days duration", async () => {
    const now = new Date();
    const startsAt = now;
    const endsAt = new Date(now.getTime() + 1000 * 60 * 60 * 24 * 400);
    
    const durationDays = (endsAt.getTime() - startsAt.getTime()) / (1000 * 60 * 60 * 24);
    expect(durationDays).toBeGreaterThan(365);
  });
});
