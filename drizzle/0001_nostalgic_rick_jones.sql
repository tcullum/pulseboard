CREATE TABLE `telemetry_devices` (
	`device_id` text PRIMARY KEY NOT NULL,
	`payload` text NOT NULL,
	`captured_at` text NOT NULL,
	`received_at` text NOT NULL
);
