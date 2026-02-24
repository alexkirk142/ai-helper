import { db } from "../db";
import { users, adminActions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import bcrypt from "bcrypt";

const BCRYPT_ROUNDS = 12;

export interface BootstrapResult {
  success: boolean;
  action: "created" | "updated" | "exists" | "skipped";
  userId?: string;
  error?: string;
}

export async function bootstrapPlatformOwner(): Promise<BootstrapResult> {
  const ownerEmail = process.env.OWNER_EMAIL;
  const ownerPasswordHash = process.env.OWNER_PASSWORD_HASH;
  const ownerPassword = process.env.OWNER_PASSWORD;
  const ownerName = process.env.OWNER_NAME || "Platform Owner";

  if (!ownerEmail) {
    console.log("[OwnerBootstrap] OWNER_EMAIL not set, skipping bootstrap");
    return { success: true, action: "skipped" };
  }

  if (!ownerPasswordHash && !ownerPassword) {
    console.error("[OwnerBootstrap] OWNER_PASSWORD_HASH or OWNER_PASSWORD required");
    return { success: false, action: "skipped", error: "Password not configured" };
  }

  let passwordHash: string;
  if (ownerPasswordHash) {
    if (!ownerPasswordHash.startsWith("$2")) {
      console.error("[OwnerBootstrap] OWNER_PASSWORD_HASH must be a valid bcrypt hash");
      return { success: false, action: "skipped", error: "Invalid password hash format" };
    }
    passwordHash = ownerPasswordHash;
  } else {
    passwordHash = await bcrypt.hash(ownerPassword!, BCRYPT_ROUNDS);
    console.log("[OwnerBootstrap] WARNING: Using OWNER_PASSWORD for initial bootstrap. Delete this env var after first run.");
  }

  const normalizedEmail = ownerEmail.toLowerCase().trim();

  const existingOwner = await db
    .select()
    .from(users)
    .where(eq(users.isPlatformOwner, true))
    .limit(1);

  if (existingOwner[0]) {
    if (existingOwner[0].email?.toLowerCase() === normalizedEmail) {
      console.log("[OwnerBootstrap] Platform owner already exists with matching email");
      return { success: true, action: "exists", userId: existingOwner[0].id };
    } else {
      console.error("[OwnerBootstrap] Platform owner exists with different email. Only one owner allowed.");
      return { 
        success: false, 
        action: "skipped", 
        error: "Platform owner already exists with different email",
        userId: existingOwner[0].id 
      };
    }
  }

  const existingUser = await db
    .select()
    .from(users)
    .where(sql`LOWER(email) = ${normalizedEmail}`)
    .limit(1);

  if (existingUser[0]) {
    await db
      .update(users)
      .set({
        isPlatformOwner: true,
        isPlatformAdmin: true,
        password: passwordHash,
        isDisabled: false,
        disabledAt: null,
        disabledReason: null,
      })
      .where(eq(users.id, existingUser[0].id));

    await db.insert(adminActions).values({
      actionType: "owner_bootstrap",
      targetType: "user",
      targetId: existingUser[0].id,
      adminId: existingUser[0].id,
      reason: "Existing user promoted to platform owner via bootstrap",
      previousState: {
        isPlatformOwner: existingUser[0].isPlatformOwner,
        isPlatformAdmin: existingUser[0].isPlatformAdmin,
      },
      metadata: { action: "promoted_existing" },
    });

    console.log(`[OwnerBootstrap] Existing user ${existingUser[0].id} promoted to platform owner`);
    return { success: true, action: "updated", userId: existingUser[0].id };
  }

  const [newOwner] = await db
    .insert(users)
    .values({
      username: normalizedEmail,
      email: normalizedEmail,
      password: passwordHash,
      role: "owner",
      authProvider: "local",
      isPlatformOwner: true,
      isPlatformAdmin: true,
      emailVerifiedAt: new Date(),
    })
    .returning();

  await db.insert(adminActions).values({
    actionType: "owner_bootstrap",
    targetType: "user",
    targetId: newOwner.id,
    adminId: newOwner.id,
    reason: "Platform owner created via bootstrap",
    metadata: { action: "created_new" },
  });

  console.log(`[OwnerBootstrap] Created new platform owner: ${newOwner.id}`);
  return { success: true, action: "created", userId: newOwner.id };
}
