CREATE TABLE `telemetry_snapshots` (
	`id` integer PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL
);
