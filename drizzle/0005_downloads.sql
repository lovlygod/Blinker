CREATE TABLE `downloads` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` text NOT NULL,
	`url` text NOT NULL,
	`referrer` text,
	`filename` text NOT NULL,
	`mime_type` text,
	`path` text NOT NULL,
	`total_bytes` integer DEFAULT 0 NOT NULL,
	`received_bytes` integer DEFAULT 0 NOT NULL,
	`state` text NOT NULL,
	`danger_type` text,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_downloads_profile_id_started_at` ON `downloads` (`profile_id`,`started_at`);
--> statement-breakpoint
CREATE INDEX `idx_downloads_state` ON `downloads` (`state`);
