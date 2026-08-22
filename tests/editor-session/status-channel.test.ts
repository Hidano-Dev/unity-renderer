import { describe, expect, it, vi } from "vitest";
import { createStatusChannel } from "../../src/editor-session/status-channel.js";

describe("StatusChannel", () => {
	it("skips partial JSON and returns completed status", async () => {
		const values = [
			'{"state":"recording"',
			JSON.stringify({ state: "recording", elapsedSec: 2 }),
			JSON.stringify({ state: "completed", timelineDurationSec: 12.5 }),
		];
		const readFile = vi.fn(async () => {
			if (values.length === 0) throw new Error("missing");
			const value = values.shift();
			if (value === undefined) throw new Error("missing");
			return value;
		});
		const result = await createStatusChannel("status.json", {
			readFile,
			unlink: vi.fn(async () => undefined),
			sleep: vi.fn(async () => undefined),
		}).poll(1, 1);

		expect(result).toEqual({
			ok: true,
			value: { state: "completed", timelineDurationSec: 12.5 },
		});
		expect(readFile).toHaveBeenCalledTimes(3);
	});

	it("returns failed status without treating the reason as a transport error", async () => {
		const result = await createStatusChannel("status.json", {
			readFile: vi.fn(async () =>
				JSON.stringify({ state: "failed", reason: "Recorder error" }),
			),
			unlink: vi.fn(async () => undefined),
		}).poll(1, 1);

		expect(result).toEqual({
			ok: true,
			value: { state: "failed", reason: "Recorder error" },
		});
	});

	it("times out when the status cannot progress", async () => {
		let clock = 0;
		const result = await createStatusChannel("status.json", {
			readFile: vi.fn(async () =>
				JSON.stringify({ state: "recording", elapsedSec: 0 }),
			),
			unlink: vi.fn(async () => undefined),
			now: () => clock,
			sleep: vi.fn(async (milliseconds) => {
				clock += milliseconds;
			}),
		}).poll(10, 0.02);

		expect(result).toEqual(expect.objectContaining({ ok: false }));
		if (!result.ok) expect(result.error.kind).toBe("recording-timeout");
	});
});
