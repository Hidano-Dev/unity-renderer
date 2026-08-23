import { describe, expect, it, vi } from "vitest";
import { type BatchPlan, createBatchRunner } from "../../src/batch/runner.js";
import type { SceneJob } from "../../src/batch/scene-job.js";

const plan: BatchPlan = {
	config: {
		projectPath: "C:\\projects\\demo",
		scenes: ["Intro", "Middle", "Outro"],
		resolution: { width: 1920, height: 1080 },
		frameRate: 30,
		formats: ["mp4"],
		output: { directory: "C:\\renders", fileName: "<Scene>" },
	},
	editor: {
		version: { raw: "6000.0.36f1", major: 6000 },
		executablePath: "Unity.exe",
	},
	scenes: [
		{ sceneName: "Intro", assetPath: "Assets/Intro.unity" },
		{ sceneName: "Middle", assetPath: "Assets/Middle.unity" },
		{ sceneName: "Outro", assetPath: "Assets/Outro.unity" },
	],
	session: {
		version: 1,
		projectPath: "C:\\projects\\demo",
		createdAt: "2026-08-23T00:00:00.000Z",
		status: "active",
		sessionDirectory: "C:\\sessions\\batch",
		files: [],
		addedPackages: [{ name: "com.unity.pipeline", version: "0.5.0-exp.1" }],
	},
};

function result(sceneName: string, outcome: "success" | "failure") {
	return {
		sceneName,
		outcome,
		warnings: [],
		outputs: [],
		durationSec: 1,
	};
}

describe("serial batch runner", () => {
	it("continues after a Scene failure, restarts the Editor, and restores once", async () => {
		const events: string[] = [];
		const sessions = [
			{
				state: "terminated" as const,
				start: vi.fn(),
				quit: vi.fn(),
				kill: vi.fn(),
			},
			{
				state: "terminated" as const,
				start: vi.fn(),
				quit: vi.fn(),
				kill: vi.fn(),
			},
			{
				state: "terminated" as const,
				start: vi.fn(),
				quit: vi.fn(),
				kill: vi.fn(),
			},
		];
		const jobs: SceneJob[] = [
			{
				run: vi.fn(async (jobPlan) => {
					events.push(`run:${jobPlan.scene.sceneName}`);
					return result("Intro", "success");
				}),
			},
			{
				run: vi.fn(async (jobPlan) => {
					events.push(`run:${jobPlan.scene.sceneName}`);
					return result("Middle", "failure");
				}),
			},
			{
				run: vi.fn(async (jobPlan) => {
					events.push(`run:${jobPlan.scene.sceneName}`);
					return result("Outro", "success");
				}),
			},
		];
		const restore = vi.fn(async () => ({
			ok: true as const,
			value: undefined,
		}));
		const runner = createBatchRunner({
			createSession: vi.fn(() => sessions.shift() as never),
			createPipeline: vi.fn(() => ({ eval: vi.fn() })),
			createSceneJob: vi.fn(() => jobs.shift() as SceneJob),
			restore,
		});
		const reporter = {
			sceneStarted: vi.fn(),
			sceneFinished: vi.fn(),
			batchSummary: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};

		const batch = await runner.run(plan, undefined, reporter);

		expect(batch).toMatchObject({
			restoreSucceeded: true,
			scenes: [
				{ outcome: "success" },
				{ outcome: "failure" },
				{ outcome: "success" },
			],
		});
		expect(events).toEqual(["run:Intro", "run:Middle", "run:Outro"]);
		expect(restore).toHaveBeenCalledOnce();
		expect(reporter.sceneStarted.mock.calls.map(([name]) => name)).toEqual([
			"Intro",
			"Middle",
			"Outro",
		]);
	});

	it("aborts the batch and skips restoration when the Editor survives", async () => {
		const events: string[] = [];
		const reporter = {
			sceneStarted: vi.fn(),
			sceneFinished: vi.fn(),
			batchSummary: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};
		const restore = vi.fn(async () => ({
			ok: true as const,
			value: undefined,
		}));
		const runner = createBatchRunner({
			createSession: () => ({
				state: "terminated" as const,
				start: vi.fn(),
				quit: vi.fn(),
				kill: vi.fn(),
			}),
			createPipeline: () => ({ eval: vi.fn() }),
			createSceneJob: () => ({
				run: vi.fn(async (jobPlan) => {
					events.push(`run:${jobPlan.scene.sceneName}`);
					return {
						...result(jobPlan.scene.sceneName, "success"),
						editorTerminationFailed: jobPlan.scene.sceneName === "Intro",
					};
				}),
			}),
			restore,
		});

		const batch = await runner.run(plan, undefined, reporter);

		// 生存 Editor と競合させないため、後続 Scene も復元も実行しない
		expect(events).toEqual(["run:Intro"]);
		expect(restore).not.toHaveBeenCalled();
		expect(batch.restoreSucceeded).toBe(false);
		expect(reporter.warn.mock.calls.flat().join("\n")).toContain(
			"Middle, Outro",
		);
	});

	it("reports a restoration failure after all Scenes finish", async () => {
		const reporter = {
			sceneStarted: vi.fn(),
			sceneFinished: vi.fn(),
			batchSummary: vi.fn(),
			warn: vi.fn(),
			debug: vi.fn(),
		};
		const runner = createBatchRunner({
			createSession: () => ({
				state: "terminated" as const,
				start: vi.fn(),
				quit: vi.fn(),
				kill: vi.fn(),
			}),
			createPipeline: () => ({ eval: vi.fn() }),
			createSceneJob: () => ({
				run: vi.fn(async () => result("Intro", "success")),
			}),
			restore: async () => ({
				ok: false as const,
				error: { kind: "restore-failed", message: "restore failed" },
			}),
		});

		const batch = await runner.run(
			{
				...plan,
				scenes: [plan.scenes[0] as NonNullable<(typeof plan.scenes)[number]>],
			},
			undefined,
			reporter,
		);

		expect(batch.restoreSucceeded).toBe(false);
		expect(reporter.warn).toHaveBeenCalledWith(
			"Project restoration failed: restore failed",
		);
	});
});
