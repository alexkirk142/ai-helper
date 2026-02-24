# New Database Migration

## Steps

1. **Read current schema** in `shared/schema.ts` — understand existing tables and relations
2. **Read the latest migration** in `migrations/` — currently `0008_price_snapshot_search_key.sql`
3. **Modify schema** in `shared/schema.ts`:
   - Add/alter table using `pgTable()` from `drizzle-orm/pg-core`
   - Add insert schema with `createInsertSchema()` from `drizzle-zod`
   - Export `Select` type: `export type Xxx = typeof xxx.$inferSelect`
   - Export `Insert` type: `export type InsertXxx = z.infer<typeof insertXxxSchema>`
4. **Generate migration**: `npx drizzle-kit generate`
5. **Review** the generated SQL in `migrations/0009_*.sql`
6. **Verify backward compatibility** — no data loss for existing rows
7. **Test on dev**: `npx drizzle-kit push`

## Drizzle config

File: `drizzle.config.ts`

```typescript
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  out: "./migrations",
  schema: "./shared/schema.ts",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL,
  },
});
```

## Table definition pattern

```typescript
import { pgTable, varchar, text, integer, boolean, timestamp, jsonb, real, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const myEntities = pgTable("my_entities", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  tenantId: varchar("tenant_id").notNull().references(() => tenants.id),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status").notNull().default("active"),
  metadata: jsonb("metadata").default({}),
  createdAt: timestamp("created_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
  updatedAt: timestamp("updated_at").default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
  uniqueIndex("my_entities_tenant_name_idx").on(table.tenantId, table.name),
]);

export const insertMyEntitySchema = createInsertSchema(myEntities).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type MyEntity = typeof myEntities.$inferSelect;
export type InsertMyEntity = z.infer<typeof insertMyEntitySchema>;
```

## Column types commonly used

```typescript
varchar("col")                        // variable-length string
text("col")                           // unbounded text
integer("col")                        // integer
real("col")                           // float
boolean("col")                        // boolean
timestamp("col")                      // timestamp
jsonb("col")                          // JSONB
varchar("col").array()                // text array (not common — prefer text().array())
text("col").array()                   // text array

// Modifiers
.primaryKey()
.notNull()
.unique()
.default(value)
.default(sql`gen_random_uuid()`)
.default(sql`CURRENT_TIMESTAMP`)
.references(() => otherTable.id)
.$type<MyUnionType>()                 // type narrowing for text columns with enum values
```

## Manual migration pattern

For operations that cannot run inside a transaction (e.g., `CREATE INDEX CONCURRENTLY`),
create a file in `migrations/manual/` and document it in `migrations/manual/README.md`.

## Migration naming convention

`NNNN_short_description.sql` — e.g., `0009_add_notifications.sql`

## Checklist

- [ ] Schema updated in `shared/schema.ts`
- [ ] Zod insert schema created with `createInsertSchema().omit()`
- [ ] Select and Insert types exported
- [ ] Migration generated with `npx drizzle-kit generate`
- [ ] Migration SQL reviewed — no destructive changes
- [ ] `DEFAULT` values set for new columns (backward compatibility)
- [ ] No data loss — columns added with `ADD COLUMN IF NOT EXISTS`
- [ ] Indexes added where needed (foreign keys, frequent query patterns)
- [ ] Rollback possible (column can be dropped without data loss)
- [ ] Storage methods added in `server/database-storage.ts`
