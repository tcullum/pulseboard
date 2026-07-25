CREATE TABLE `docker_commands` (
	`id` text PRIMARY KEY NOT NULL,
	`device_id` text NOT NULL,
	`container_name` text NOT NULL,
	`action` text NOT NULL,
	`status` text NOT NULL,
	`requested_by` text NOT NULL,
	`requested_at` text NOT NULL,
	`claimed_at` text,
	`completed_at` text,
	`result` text
);
