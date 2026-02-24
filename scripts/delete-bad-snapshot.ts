/**
 * One-off script: delete bad global price snapshot for OEM 4500039666.
 * Run: npx tsx scripts/delete-bad-snapshot.ts
 */
import { db } from "../server/db";
import { priceSnapshots } from "../shared/schema";
import { eq, isNull, and } from "drizzle-orm";

async function main() {
  const TARGET_OEM = "4500039666";

  const before = await db
    .select({
      id: priceSnapshots.id,
      oem: priceSnapshots.oem,
      source: priceSnapshots.source,
      modelName: priceSnapshots.modelName,
      minPrice: priceSnapshots.minPrice,
      maxPrice: priceSnapshots.maxPrice,
      createdAt: priceSnapshots.createdAt,
    })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.oem, TARGET_OEM), isNull(priceSnapshots.tenantId)));

  if (before.length === 0) {
    console.log(`No global cache rows found for OEM "${TARGET_OEM}" — nothing to delete.`);
    process.exit(0);
  }

  console.log(`Found ${before.length} row(s) to delete:`);
  for (const row of before) {
    console.log(`  id=${row.id}  source=${row.source}  modelName=${row.modelName ?? "(null)"}  price=${row.minPrice}–${row.maxPrice}  created=${row.createdAt?.toISOString()}`);
  }

  const result = await db
    .delete(priceSnapshots)
    .where(and(eq(priceSnapshots.oem, TARGET_OEM), isNull(priceSnapshots.tenantId)));

  console.log(`\nDeleted ${(result as any).rowCount ?? "?"} row(s).`);

  const after = await db
    .select({ id: priceSnapshots.id })
    .from(priceSnapshots)
    .where(and(eq(priceSnapshots.oem, TARGET_OEM), isNull(priceSnapshots.tenantId)));

  if (after.length === 0) {
    console.log("Confirmed: no global cache rows remain for this OEM.");
  } else {
    console.error(`WARNING: ${after.length} row(s) still present!`, after);
    process.exit(1);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error("Script failed:", err);
  process.exit(1);
});
