import { describe, expect, it, vi } from "vitest";
import {
	cleanRecorderTracks,
	parseRecorderTrackReport,
} from "../../src/batch/recorder-tracks.js";
import { err, ok } from "../../src/shared/types.js";

function scanResponse(
	overrides: Record<string, unknown> = {},
	mode: "scan" | "remove" = "scan",
): string {
	return JSON.stringify({
		ok: true,
		mode,
		timelines: [],
		removed: 0,
		timelineDurationSec: 5,
		timelineFrameRate: 30,
		warnings: [],
		...overrides,
	});
}

const oneTimeline = [
	{
		assetPath: "Assets/Timelines/Intro.playable",
		chain: "root",
		tracks: ["Recorder Track"],
	},
];

describe("parseRecorderTrackReport", () => {
	it("reads a successful report", () => {
		const parsed = parseRecorderTrackReport(
			scanResponse({ timelines: oneTimeline, warnings: ["a"] }),
		);

		expect(parsed.ok).toBe(true);
		if (!parsed.ok) return;
		expect(parsed.value.timelines).toEqual(oneTimeline);
		expect(parsed.value.timelineDurationSec).toBe(5);
		expect(parsed.value.warnings).toEqual(["a"]);
	});

	it("surfaces the Unity-side error message", () => {
		const parsed = parseRecorderTrackReport(
			JSON.stringify({ ok: false, error: "RecorderTrack type was not found" }),
		);

		expect(parsed.ok).toBe(false);
		if (parsed.ok) return;
		expect(parsed.error.message).toBe("RecorderTrack type was not found");
	});

	it("rejects invalid JSON", () => {
		expect(parseRecorderTrackReport("not json").ok).toBe(false);
	});
});

describe("cleanRecorderTracks", () => {
	it("leaves the project alone when no RecorderTrack exists", async () => {
		const evalPayload = vi.fn(async (_mode: "scan" | "remove") =>
			ok(scanResponse()),
		);
		const registerBackups = vi.fn(async (_paths: readonly string[]) =>
			ok(undefined),
		);

		const result = await cleanRecorderTracks({ evalPayload, registerBackups });

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.removed).toBe(0);
		// scan だけで終わる: remove も、バックアップの登録も走らせない
		expect(evalPayload).toHaveBeenCalledTimes(1);
		expect(evalPayload).toHaveBeenCalledWith("scan");
		expect(registerBackups).not.toHaveBeenCalled();
	});

	it("backs the Timeline assets up before removing anything", async () => {
		const order: string[] = [];
		const evalPayload = vi.fn(async (mode: "scan" | "remove") => {
			order.push(mode);
			return ok(
				mode === "scan"
					? scanResponse({ timelines: oneTimeline })
					: scanResponse(
							{ timelines: oneTimeline, removed: 1, timelineDurationSec: 3 },
							"remove",
						),
			);
		});
		const registerBackups = vi.fn(async (_paths: readonly string[]) => {
			order.push("backup");
			return ok(undefined);
		});

		const result = await cleanRecorderTracks({ evalPayload, registerBackups });

		expect(order).toEqual(["scan", "backup", "remove"]);
		expect(registerBackups).toHaveBeenCalledWith([
			"Assets/Timelines/Intro.playable",
		]);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.removed).toBe(1);
		// 削除で Timeline が短くなった場合は、その値を呼び出し元へ返す
		expect(result.value.timelineDurationSec).toBe(3);
		expect(result.value.warnings).toEqual([
			expect.stringContaining("Assets/Timelines/Intro.playable"),
		]);
	});

	it("does not remove anything when the backup fails", async () => {
		const evalPayload = vi.fn(async (_mode: "scan" | "remove") =>
			ok(scanResponse({ timelines: oneTimeline })),
		);

		const result = await cleanRecorderTracks({
			evalPayload,
			registerBackups: async () => err({ message: "disk full" }),
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("disk full");
		expect(evalPayload).toHaveBeenCalledTimes(1);
	});

	it("warns when it proceeds without a backup registry", async () => {
		const result = await cleanRecorderTracks({
			evalPayload: async (mode) =>
				ok(
					mode === "scan"
						? scanResponse({ timelines: oneTimeline })
						: scanResponse({ timelines: oneTimeline, removed: 1 }, "remove"),
				),
		});

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.warnings).toContainEqual(
			expect.stringContaining("バックアップは取得していません"),
		);
	});

	it("skips the backup for a Timeline with no resolvable asset path", async () => {
		const registerBackups = vi.fn(async (_paths: readonly string[]) =>
			ok(undefined),
		);
		const timelines = [{ assetPath: "", chain: "root", tracks: ["Recorder"] }];

		await cleanRecorderTracks({
			evalPayload: async (mode) =>
				ok(
					mode === "scan"
						? scanResponse({ timelines })
						: scanResponse({ timelines, removed: 1 }, "remove"),
				),
			registerBackups,
		});

		expect(registerBackups).toHaveBeenCalledWith([]);
	});

	it("fails when the scan eval fails", async () => {
		const result = await cleanRecorderTracks({
			evalPayload: async () => err({ message: "eval transport failed" }),
		});

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.message).toBe("eval transport failed");
	});
});
