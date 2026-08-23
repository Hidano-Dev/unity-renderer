import { describe, expect, it } from "vitest";
import { createLogger, type LogEntry } from "../../src/shared/logger.js";

describe("createLogger", () => {
	function capture() {
		const entries: LogEntry[] = [];
		return {
			entries,
			logger: createLogger({
				debug: false,
				sink: (entry) => entries.push(entry),
			}),
		};
	}

	it("emits normal messages while keeping debug messages out of normal mode", () => {
		const { entries, logger } = capture();

		logger.info("started");
		logger.warn("warning");
		logger.debug("payload details");

		expect(entries.map((entry) => entry.message)).toEqual([
			"started",
			"warning",
		]);
		expect(entries.every((entry) => entry.level !== "debug")).toBe(true);
	});

	it("emits debug messages only when debug mode is enabled", () => {
		const entries: LogEntry[] = [];
		const logger = createLogger({
			debug: true,
			sink: (entry) => entries.push(entry),
		});

		logger.debug("payload details");

		expect(entries).toEqual([{ level: "debug", message: "payload details" }]);
	});
});
