CREATE TABLE `reward_accounts` (
	`user_id` text PRIMARY KEY NOT NULL,
	`balance` integer DEFAULT 0 NOT NULL,
	`total_earned` integer DEFAULT 0 NOT NULL,
	`total_active_ms` integer DEFAULT 0 NOT NULL,
	`day_key` text NOT NULL,
	`today_earned` integer DEFAULT 0 NOT NULL,
	`today_active_ms` integer DEFAULT 0 NOT NULL,
	`session_id` text,
	`session_sequence` integer DEFAULT 0 NOT NULL,
	`last_seen` integer,
	`last_visible` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation` text,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `reward_daily` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`day_key` text NOT NULL,
	`points` integer DEFAULT 0 NOT NULL,
	`active_ms` integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_daily_user_day` ON `reward_daily` (`user_id`,`day_key`);--> statement-breakpoint
CREATE TABLE `reward_exchanges` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`method` text NOT NULL,
	`points` integer NOT NULL,
	`status` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`created_at` integer NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `reward_exchange_idempotency` ON `reward_exchanges` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE TABLE `reward_ledger` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`type` text NOT NULL,
	`points` integer NOT NULL,
	`created_at` integer NOT NULL,
	`description` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `reward_ledger_user_time` ON `reward_ledger` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sponsor_campaigns` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company` text NOT NULL,
	`title` text NOT NULL,
	`description` text NOT NULL,
	`url` text NOT NULL,
	`amount_yen` integer NOT NULL,
	`days` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`created_at` integer NOT NULL,
	`starts_at` integer,
	`ends_at` integer,
	`revision` integer DEFAULT 0 NOT NULL,
	`last_mutation` text,
	CONSTRAINT "sponsor_campaign_amount_range" CHECK("sponsor_campaigns"."amount_yen" >= 100 AND "sponsor_campaigns"."amount_yen" <= 10000000),
	CONSTRAINT "sponsor_campaign_days_range" CHECK("sponsor_campaigns"."days" >= 1 AND "sponsor_campaigns"."days" <= 90)
);
--> statement-breakpoint
CREATE INDEX `sponsor_campaign_user_time` ON `sponsor_campaigns` (`user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `sponsor_settlements` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`gross_yen` integer NOT NULL,
	`deductions_yen` integer NOT NULL,
	`net_yen` integer NOT NULL,
	`reward_yen` integer NOT NULL,
	`reserve_yen` integer NOT NULL,
	`operations_yen` integer NOT NULL,
	`growth_yen` integer NOT NULL,
	`simulation` integer DEFAULT 1 NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `sponsor_campaigns`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sponsor_settlement_demo_only" CHECK("sponsor_settlements"."simulation" = 1),
	CONSTRAINT "sponsor_settlement_nonnegative" CHECK("sponsor_settlements"."gross_yen" >= 0 AND "sponsor_settlements"."deductions_yen" >= 0 AND "sponsor_settlements"."net_yen" >= 0 AND "sponsor_settlements"."reward_yen" >= 0 AND "sponsor_settlements"."reserve_yen" >= 0 AND "sponsor_settlements"."operations_yen" >= 0 AND "sponsor_settlements"."growth_yen" >= 0),
	CONSTRAINT "sponsor_settlement_balanced" CHECK("sponsor_settlements"."net_yen" = "sponsor_settlements"."reward_yen" + "sponsor_settlements"."reserve_yen" + "sponsor_settlements"."operations_yen" + "sponsor_settlements"."growth_yen")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_settlement_idempotency` ON `sponsor_settlements` (`user_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_settlement_campaign` ON `sponsor_settlements` (`user_id`,`campaign_id`);--> statement-breakpoint
CREATE INDEX `sponsor_settlement_user_time` ON `sponsor_settlements` (`user_id`,`created_at`);