import { describe, expect, it, vi } from "vitest";
import type { AudioRemuxHookError } from "../../../src/audio-remux/types.js";
import type { SceneJobPlan } from "../../../src/batch/scene-job.js";
import { createSceneJob } from "../../../src/batch/scene-job.js";
import { createCompositionHooks } from "../../../src/cli/index.js";
import { toExitCode } from "../../../src/reporting/exit-code.js";
import { createProgressReporter } from "../../../src/reporting/progress.js";

const plan = {
	config: {
		projectPath: "C:\\project",
		scenes: ["Scene"],
		resolution: { width: 1920, height: 1080 },
		frameRate: 30,
		formats: ["mp4"],
		output: { directory: "C:\\renders", fileName: "<Scene>" },
	},
	editor: {
		version: { raw: "6000.0.36f1", major: 6000 },
		executablePath: "Unity.exe",
	},
	scene: { sceneName: "Scene", assetPath: "Assets/Scene.unity" },
	sessionDir: "C:\\sessions\\scene",
} satisfies SceneJobPlan;

function dependencies(hookError: unknown) {
	return {
		session: {
			start: vi.fn(async () => ({ ok: true as const, value: undefined })),
			quit: vi.fn(async () => undefined),
			kill: vi.fn(async () => undefined),
			state: "connected" as const,
		},
		pipeline: {
			eval: vi.fn(async () => ({
				ok: true as const,
				value: {
					returnValue: JSON.stringify({
						directorFound: true,
						directorName: "Director",
						timelineDurationSec: 1,
						timelineFrameRate: 30,
					}),
				},
			})),
		},
		statusChannel: () => ({
			statusFilePath: "C:\\sessions\\scene\\status.json",
			reset: vi.fn(async () => undefined),
			poll: vi.fn(async () => ({
				ok: true as const,
				value: { state: "completed" as const, timelineDurationSec: 1 },
			})),
		}),
		cleanup: vi.fn(async () => undefined),
		validate: vi.fn(async () => []),
		promote: vi.fn(async () => undefined),
		planOutputs: vi.fn(async () => [
			{
				format: "mp4" as const,
				path: "C:\\renders\\Scene.mp4",
				stagingPath: "C:\\renders\\Scene.mp4.staging",
			},
		]),
		runHooks: vi.fn(async () => ({
			ok: false as const,
			error: { message: String(hookError) },
		})),
	};
}

describe("core reporting contract for audio hook failures", () => {
	it("registers the audio remux hook in the composition root", () => {
		expect(createCompositionHooks()?.afterRecording).toBeTypeOf("function");
	});

	it("reports preserved video output as hook failure, distinct from recording failure", async () => {
		const audioFailure = {
			category: "mux",
			message: "one or more outputs failed during audio muxing",
		} as AudioRemuxHookError;
		const deps = dependencies(audioFailure);
		const result = await createSceneJob(deps).run(plan);
		const output: string[] = [];
		createProgressReporter({
			write: (message) => output.push(message),
			isTTY: false,
		}).sceneFinished(result);

		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "hook-failed",
			outputs: [{ videoPath: "C:\\renders\\Scene.mp4" }],
		});
		expect(toExitCode({ scenes: [result], restoreSucceeded: true })).toBe(2);
		expect(output.join("")).toContain("C:\\renders\\Scene.mp4");

		const videoFailure = {
			...result,
			failureReason: "recording-failed" as const,
			outputs: [],
		};
		expect(videoFailure.failureReason).not.toBe(result.failureReason);
		expect(videoFailure.outputs).toEqual([]);
	});
});
