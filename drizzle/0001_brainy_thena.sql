CREATE TABLE `sponsor_views` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`campaign_id` text NOT NULL,
	`session_id` text NOT NULL,
	`sequence` integer DEFAULT 0 NOT NULL,
	`last_seen` integer NOT NULL,
	`last_visible` integer DEFAULT 0 NOT NULL,
	`visible_ms` integer DEFAULT 0 NOT NULL,
	`confirmed_intervals` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`campaign_id`) REFERENCES `sponsor_campaigns`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sponsor_view_session` ON `sponsor_views` (`user_id`,`campaign_id`,`session_id`);--> statement-breakpoint
CREATE INDEX `sponsor_view_report` ON `sponsor_views` (`user_id`,`campaign_id`);