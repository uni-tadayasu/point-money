CREATE TABLE `sponsor_prospects` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`company_name` text NOT NULL,
	`website_url` text,
	`estimated_amount_yen` integer NOT NULL,
	`stage` text DEFAULT 'candidate' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`archived_at` integer,
	CONSTRAINT "sponsor_prospect_amount_range" CHECK("sponsor_prospects"."estimated_amount_yen" >= 0 AND "sponsor_prospects"."estimated_amount_yen" <= 10000000),
	CONSTRAINT "sponsor_prospect_stage_valid" CHECK("sponsor_prospects"."stage" IN ('candidate', 'preparing', 'contacted', 'negotiating', 'agreed', 'closed')),
	CONSTRAINT "sponsor_prospect_revision_valid" CHECK("sponsor_prospects"."revision" >= 0)
);
--> statement-breakpoint
CREATE INDEX `sponsor_prospect_user_updated` ON `sponsor_prospects` (`user_id`,`updated_at`);