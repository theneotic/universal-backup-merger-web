CREATE TABLE `merge_sessions` (
	`id` varchar(64) NOT NULL,
	`visitor_id` varchar(64) NOT NULL,
	`target_file_name` varchar(500) NOT NULL,
	`source_file_names` text NOT NULL,
	`output_key` varchar(1000),
	`output_url` varchar(1200),
	`report_json` text NOT NULL,
	`status` enum('success','failed') NOT NULL,
	`created_at` timestamp NOT NULL DEFAULT (now()),
	CONSTRAINT `merge_sessions_id` PRIMARY KEY(`id`)
);
--> statement-breakpoint
CREATE INDEX `merge_sessions_visitor_idx` ON `merge_sessions` (`visitor_id`);