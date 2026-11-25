import { integer, sqliteTable, text, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export * from "./sponsor-prospects-schema";

export * from "./sponsor-schema";

// Non-redeemable demo units. No payment credentials or personal details are stored.
export const rewardAccounts = sqliteTable("reward_accounts", {
  userId: text("user_id").primaryKey(),
  balance: integer("balance").notNull().default(0),
  totalEarned: integer("total_earned").notNull().default(0),
  totalActiveMs: integer("total_active_ms").notNull().default(0),
  dayKey: text("day_key").notNull(),
  todayEarned: integer("today_earned").notNull().default(0),
  todayActiveMs: integer("today_active_ms").notNull().default(0),
  sessionId: text("session_id"),
  sessionSequence: integer("session_sequence").notNull().default(0),
  lastSeen: integer("last_seen"),
  lastVisible: integer("last_visible").notNull().default(0),
  revision: integer("revision").notNull().default(0),
  lastMutation: text("last_mutation"),
  createdAt: integer("created_at").notNull(),
});

export const rewardDaily = sqliteTable("reward_daily", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  dayKey: text("day_key").notNull(),
  points: integer("points").notNull().default(0),
  activeMs: integer("active_ms").notNull().default(0),
}, (table) => [uniqueIndex("reward_daily_user_day").on(table.userId, table.dayKey)]);

export const rewardLedger = sqliteTable("reward_ledger", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  type: text("type").notNull(),
  points: integer("points").notNull(),
  createdAt: integer("created_at").notNull(),
  description: text("description").notNull(),
}, (table) => [index("reward_ledger_user_time").on(table.userId, table.createdAt)]);

export const rewardExchanges = sqliteTable("reward_exchanges", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  method: text("method").notNull(),
  points: integer("points").notNull(),
  status: text("status").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  createdAt: integer("created_at").notNull(),
}, (table) => [uniqueIndex("reward_exchange_idempotency").on(table.userId, table.idempotencyKey)]);
