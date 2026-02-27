/**
 * One-off script: enable GEARBOX_TAG_MINLEN_4 feature flag.
 *
 * Usage (enable globally for all tenants):
 *   npx tsx scripts/enable-gearbox-tag-minlen4.ts
 *
 * Usage (enable for a specific tenant only):
 *   npx tsx scripts/enable-gearbox-tag-minlen4.ts <tenantId>
 *
 * To disable again:
 *   npx tsx scripts/enable-gearbox-tag-minlen4.ts --disable
 *   npx tsx scripts/enable-gearbox-tag-minlen4.ts <tenantId> --disable
 */
import { db } from "../server/db";
import { featureFlags } from "../shared/schema";
import { eq, isNull, and } from "drizzle-orm";
import { randomUUID } from "crypto";

const FLAG_NAME = "GEARBOX_TAG_MINLEN_4";

async function main() {
  const args = process.argv.slice(2);
  const disable = args.includes("--disable");
  const tenantId = args.find((a) => !a.startsWith("--")) ?? null;
  const enabled = !disable;

  const scope = tenantId ? `tenant ${tenantId}` : "global (all tenants)";
  console.log(`\n${enabled ? "Enabling" : "Disabling"} ${FLAG_NAME} for ${scope}…`);

  // Check current state
  let existing;
  if (tenantId) {
    [existing] = await db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.name, FLAG_NAME), eq(featureFlags.tenantId, tenantId)))
      .limit(1);
  } else {
    [existing] = await db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.name, FLAG_NAME), isNull(featureFlags.tenantId)))
      .limit(1);
  }

  if (existing) {
    console.log(`  Current state: enabled=${existing.enabled}  id=${existing.id}`);
    if (existing.enabled === enabled) {
      console.log(`  Already ${enabled ? "enabled" : "disabled"} — no change needed.`);
      process.exit(0);
    }

    // Update
    if (tenantId) {
      await db
        .update(featureFlags)
        .set({ enabled, updatedAt: new Date() })
        .where(and(eq(featureFlags.name, FLAG_NAME), eq(featureFlags.tenantId, tenantId)));
    } else {
      await db
        .update(featureFlags)
        .set({ enabled, updatedAt: new Date() })
        .where(and(eq(featureFlags.name, FLAG_NAME), isNull(featureFlags.tenantId)));
    }
    console.log(`  ✓ Updated: enabled=${enabled}`);
  } else {
    // Insert
    const id = randomUUID();
    await db.insert(featureFlags).values({
      id,
      name: FLAG_NAME,
      description:
        "Allow 4-character gearbox tag OCR codes (e.g. S4TA, A131, K312) through the quality gate. Routes to clarification only.",
      enabled,
      tenantId: tenantId ?? null,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.log(`  ✓ Inserted: id=${id}  enabled=${enabled}`);
  }

  // Verify
  let verified;
  if (tenantId) {
    [verified] = await db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.name, FLAG_NAME), eq(featureFlags.tenantId, tenantId)))
      .limit(1);
  } else {
    [verified] = await db
      .select()
      .from(featureFlags)
      .where(and(eq(featureFlags.name, FLAG_NAME), isNull(featureFlags.tenantId)))
      .limit(1);
  }

  if (verified?.enabled === enabled) {
    console.log(`\n✅ Done. ${FLAG_NAME} is now ${enabled ? "ENABLED" : "DISABLED"} for ${scope}.`);
    console.log(
      enabled
        ? "   4-char codes like S4TA will now route to clarification (not clearer-photo prompt)."
        : "   4-char codes will again be rejected by the quality gate.",
    );
  } else {
    console.error("\n❌ Verification failed — flag state does not match expected value.");
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
