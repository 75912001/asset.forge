CREATE TABLE `workspace_records` (
	`owner_id` text NOT NULL,
	`kind` text NOT NULL,
	`entry_key` text NOT NULL,
	`position` integer NOT NULL,
	`payload` text NOT NULL,
	PRIMARY KEY(`owner_id`, `kind`, `entry_key`),
	FOREIGN KEY (`owner_id`) REFERENCES `workspaces`(`owner_id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `workspaces` (
	`owner_id` text PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	`migration_id` text,
	`migration_hash` text
);
