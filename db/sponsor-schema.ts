import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

// This is a private, account-owned commercial planning simulation, never real funds.
export const sponsorCampaigns = sqliteTable("sponsor_campaigns", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  company: text("company").notNull(),
  title: text("title").notNull(),
  description: text("description").notNull(),
  url: text("url").notNull(),
  amountYen: integer("amount_yen").notNull(),
  days: integer("days").notNull(),
  status: text("status").notNull().default("draft"),
  createdAt: integer("created_at").notNull(),
  startsAt: integer("starts_at"),
  endsAt: integer("ends_at"),
  revision: integer("revision").notNull().default(0),
  lastMutation: text("last_mutation"),
}, (table) => [
  index("sponsor_campaign_user_time").on(table.userId, table.createdAt),
  check("sponsor_campaign_amount_range", sql`${table.amountYen} >= 100 AND ${table.amountYen} <= 10000000`),
  check("sponsor_campaign_days_range", sql`${table.days} >= 1 AND ${table.days} <= 90`),
]);

export const sponsorSettlements = sqliteTable("sponsor_settlements", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  campaignId: text("campaign_id").notNull().references(() => sponsorCampaigns.id),
  idempotencyKey: text("idempotency_key").notNull(),
  grossYen: integer("gross_yen").notNull(),
  deductionsYen: integer("deductions_yen").notNull(),
  netYen: integer("net_yen").notNull(),
  rewardYen: integer("reward_yen").notNull(),
  reserveYen: integer("reserve_yen").notNull(),
  operationsYen: integer("operations_yen").notNull(),
  growthYen: integer("growth_yen").notNull(),
  simulation: integer("simulation").notNull().default(1),
  createdAt: integer("created_at").notNull(),
}, (table) => [
  uniqueIndex("sponsor_settlement_idempotency").on(table.userId, table.idempotencyKey),
  uniqueIndex("sponsor_settlement_campaign").on(table.userId, table.campaignId),
  index("sponsor_settlement_user_time").on(table.userId, table.createdAt),
  check("sponsor_settlement_demo_only", sql`${table.simulation} = 1`),
  check("sponsor_settlement_nonnegative", sql`${table.grossYen} >= 0 AND ${table.deductionsYen} >= 0 AND ${table.netYen} >= 0 AND ${table.rewardYen} >= 0 AND ${table.reserveYen} >= 0 AND ${table.operationsYen} >= 0 AND ${table.growthYen} >= 0`),
  check("sponsor_settlement_balanced", sql`${table.netYen} = ${table.rewardYen} + ${table.reserveYen} + ${table.operationsYen} + ${table.growthYen}`),
]);

// Visibility telemetry measures demo intervals only, never certified humans or clicks.
export const sponsorViews = sqliteTable("sponsor_views", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  campaignId: text("campaign_id").notNull().references(() => sponsorCampaigns.id),
  sessionId: text("session_id").notNull(),
  sequence: integer("sequence").notNull().default(0),
  lastSeen: integer("last_seen").notNull(),
  lastVisible: integer("last_visible").notNull().default(0),
  visibleMs: integer("visible_ms").notNull().default(0),
  confirmedIntervals: integer("confirmed_intervals").notNull().default(0),
  revision: integer("revision").notNull().default(0),
}, (table) => [
  uniqueIndex("sponsor_view_session").on(table.userId, table.campaignId, table.sessionId),
  index("sponsor_view_report").on(table.userId, table.campaignId),
]);
