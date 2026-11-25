import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// Sales planning notes only. These records never credit payment or reward balances.
export const sponsorProspects = sqliteTable("sponsor_prospects", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  companyName: text("company_name").notNull(),
  websiteUrl: text("website_url"),
  estimatedAmountYen: integer("estimated_amount_yen").notNull(),
  stage: text("stage").notNull().default("candidate"),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
  revision: integer("revision").notNull().default(0),
  archivedAt: integer("archived_at"),
}, (table) => [
  index("sponsor_prospect_user_updated").on(table.userId, table.updatedAt),
  check("sponsor_prospect_amount_range", sql`${table.estimatedAmountYen} >= 0 AND ${table.estimatedAmountYen} <= 10000000`),
  check("sponsor_prospect_stage_valid", sql`${table.stage} IN ('candidate', 'preparing', 'contacted', 'negotiating', 'agreed', 'closed')`),
  check("sponsor_prospect_revision_valid", sql`${table.revision} >= 0`),
]);
