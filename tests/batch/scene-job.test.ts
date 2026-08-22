import { describe, expect, it, vi } from "vitest";
import {
	createSceneJob,
	type SceneJobPlan,
} from "../../src/batch/scene-job.js";
import type { StatusChannel } from "../../src/editor-session/status-channel.js";

const plan: SceneJobPlan = {
	config: {
		projectPath: "C:\\projects\\demo",
		scenes: ["Intro"],
		resolution: { width: 1920, height: 1080 },
		frameRate: 30,
		formats: ["mp4", "mov-prores"],
		output: { directory: "C:\\renders", fileName: "<Scene>_<Take>" },
		debug: false,
		timeouts: { editorStartSec: 1, editorQuitSec: 1, recordingSec: 1 },
	},
	editor: {
		version: { raw: "6000.0.36f1", major: 6000 },
		executablePath: "Unity.exe",
	},
	scene: { sceneName: "Intro", assetPath: "Assets/Intro.unity" },
	sessionDir: "C:\\sessions\\one",
};

function setup(
	openResult: unknown = {
		directorFound: true,
		multipleDirectorsWarning: true,
		directorName: "Director",
		timelineDurationSec: 2,
		timelineFrameRate: 30,
	},
) {
	const session = {
		start: vi.fn(async () => ({ ok: true as const, value: undefined })),
		quit: vi.fn(async () => undefined),
		kill: vi.fn(async () => undefined),
		state: "connected" as const,
	};
	const evalCalls: string[] = [];
	const pipeline = {
		eval: vi.fn(async (payload: { id: string }) => {
			evalCalls.push(payload.id);
			return {
				ok: true as const,
				value: {
					returnValue:
						payload.id === "open-scene" ? JSON.stringify(openResult) : "{}",
				},
			};
		}),
	};
	const status = {
		statusFilePath: "C:\\sessions\\one\\status.json",
		poll: vi.fn(async () => ({
			ok: true as const,
			value: { state: "completed" as const, timelineDurationSec: 2 },
		})),
	};
	const job = createSceneJob({
		session,
		pipeline,
		statusChannel: () => status as StatusChannel,
		planOutputs: vi.fn(async () => [
			{ format: "mp4" as const, path: "C:\\renders\\Intro_1.mp4" },
			{ format: "mov-prores" as const, path: "C:\\renders\\Intro_1.mov" },
		]),
		validate: vi.fn(async (paths) => paths),
		cleanup: vi.fn(async () => undefined),
		runHooks: vi.fn(async () => ({ ok: true as const, value: undefined })),
	});
	return { job, session, pipeline, status, evalCalls };
}

describe("one scene job", () => {
	it("runs launch through recording, verification, hook, and graceful quit", async () => {
		const { job, session, evalCalls } = setup();
		const result = await job.run(plan);
		expect(result).toMatchObject({
			outcome: "success",
			warnings: [expect.stringContaining("Multiple")],
		});
		expect(evalCalls).toEqual([
			"open-scene",
			"setup-recorder",
			"start-recording",
		]);
		expect(session.quit).toHaveBeenCalledOnce();
	});

	it("converges a missing Director to cleanup and Editor termination", async () => {
		const { job, session } = setup({
			directorFound: false,
			multipleDirectorsWarning: false,
			directorName: null,
			timelineDurationSec: null,
			timelineFrameRate: null,
		});
		const result = await job.run(plan);
		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "no-playable-director",
		});
		expect(session.quit).toHaveBeenCalledOnce();
	});

	it("forces cleanup for a recording timeout", async () => {
		const context = setup();
		context.status.poll.mockResolvedValue({
			ok: false as const,
			error: { kind: "recording-timeout" as const, message: "timeout" },
		} as never);
		const result = await context.job.run(plan);
		expect(result.failureReason).toBe("recording-timeout");
		expect(context.session.quit).toHaveBeenCalledOnce();
	});
});
