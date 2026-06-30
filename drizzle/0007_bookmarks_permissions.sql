CREATE TABLE `bookmarks` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `profile_id` text NOT NULL,
  `url` text NOT NULL,
  `title` text NOT NULL,
  `folder` text DEFAULT 'Bookmarks bar' NOT NULL,
  `favicon_url` text,
  `created_at` integer NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_bookmarks_profile_id` ON `bookmarks` (`profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_bookmarks_profile_url` ON `bookmarks` (`profile_id`,`url`);
--> statement-breakpoint
CREATE TABLE `site_permissions` (
  `id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
  `profile_id` text NOT NULL,
  `origin` text NOT NULL,
  `permission` text NOT NULL,
  `setting` text DEFAULT 'ask' NOT NULL,
  `updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `idx_site_permissions_profile_id` ON `site_permissions` (`profile_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `idx_site_permissions_profile_origin_permission` ON `site_permissions` (`profile_id`,`origin`,`permission`);
