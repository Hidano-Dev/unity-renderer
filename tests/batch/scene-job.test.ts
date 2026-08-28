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

/** RecorderTrack が 1 本も無い Timeline の応答。既定ではこの経路を通す。 */
const NO_RECORDER_TRACKS = JSON.stringify({
	ok: true,
	mode: "scan",
	timelines: [],
	removed: 0,
	timelineDurationSec: 2,
	timelineFrameRate: 30,
	warnings: [],
});

function payloadReturnValue(id: string, openResult: unknown): string {
	if (id === "open-scene") return JSON.stringify(openResult);
	if (id === "recorder-tracks") return NO_RECORDER_TRACKS;
	return "{}";
}

const DEFAULT_OPEN_RESULT = {
	directorFound: true,
	multipleDirectorsWarning: false,
	directorName: "Director",
	timelineDurationSec: 2,
	timelineFrameRate: 30,
};

function setup(
	openResult: unknown = {
		...DEFAULT_OPEN_RESULT,
		multipleDirectorsWarning: true,
	},
) {
	const session = {
		start: vi.fn(async () => ({ ok: true as const, value: undefined })),
		quit: vi.fn(async () => undefined),
		kill: vi.fn(async () => undefined),
		state: "connected" as const,
	};
	const evalCalls: string[] = [];
	const evalSources: string[] = [];
	const pipeline = {
		eval: vi.fn(async (payload: { id: string; source: string }) => {
			evalCalls.push(payload.id);
			evalSources.push(payload.source);
			return {
				ok: true as const,
				value: { returnValue: payloadReturnValue(payload.id, openResult) },
			};
		}),
	};
	const status = {
		statusFilePath: "C:\\sessions\\one\\status.json",
		reset: vi.fn(async () => undefined),
		poll: vi.fn(async () => ({
			ok: true as const,
			value: { state: "completed" as const, timelineDurationSec: 2 },
		})),
	};
	const sleep = vi.fn(async () => undefined);
	const cleanup = vi.fn(async () => undefined);
	const promote = vi.fn(async () => undefined);
	const runHooks = vi.fn(async () => ({ ok: true as const, value: undefined }));
	const job = createSceneJob({
		session,
		pipeline,
		statusChannel: () => status as StatusChannel,
		planOutputs: vi.fn(async () => [
			{
				format: "mp4" as const,
				path: "C:\\renders\\Intro_1.mp4",
				stagingPath: "C:\\renders\\Intro_1.urc-partial.mp4",
			},
			{
				format: "mov-prores" as const,
				path: "C:\\renders\\Intro_1.mov",
				stagingPath: "C:\\renders\\Intro_1.urc-partial.mov",
			},
		]),
		validate: vi.fn(async (paths) => paths),
		cleanup,
		promote,
		runHooks,
		sleep,
	});
	return {
		job,
		session,
		pipeline,
		status,
		evalCalls,
		evalSources,
		sleep,
		cleanup,
		promote,
		runHooks,
	};
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
			"recorder-tracks",
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

	it("retries start-recording until the Play Mode transition completes", async () => {
		const context = setup();
		let startAttempts = 0;
		context.pipeline.eval.mockImplementation((async (payload: {
			id: string;
		}) => {
			if (payload.id === "open-scene")
				return {
					ok: true as const,
					value: {
						returnValue: JSON.stringify({
							directorFound: true,
							multipleDirectorsWarning: false,
							directorName: "Director",
							timelineDurationSec: 2,
							timelineFrameRate: 30,
						}),
					},
				};
			if (payload.id === "start-recording" && ++startAttempts === 1)
				return {
					ok: false as const,
					error: {
						kind: "eval-failed" as const,
						payloadId: "start-recording",
						message:
							"PLAY_MODE_NOT_READY: the Play Mode transition has not completed yet",
					},
				};
			return {
				ok: true as const,
				value: {
					returnValue: payloadReturnValue(payload.id, DEFAULT_OPEN_RESULT),
				},
			};
		}) as never);
		const result = await context.job.run(plan);
		expect(result.outcome).toBe("success");
		expect(startAttempts).toBe(2);
		expect(context.sleep).toHaveBeenCalledWith(2_000);
	});

	it("fails without retrying when start-recording reports a non-retriable error", async () => {
		const context = setup();
		let startAttempts = 0;
		context.pipeline.eval.mockImplementation((async (payload: {
			id: string;
		}) => {
			if (payload.id === "open-scene")
				return {
					ok: true as const,
					value: {
						returnValue: JSON.stringify({
							directorFound: true,
							multipleDirectorsWarning: false,
							directorName: "Director",
							timelineDurationSec: 2,
							timelineFrameRate: 30,
						}),
					},
				};
			if (payload.id === "start-recording") {
				startAttempts += 1;
				return {
					ok: false as const,
					error: {
						kind: "eval-failed" as const,
						payloadId: "start-recording",
						message: "Unsupported recorder format: webm",
					},
				};
			}
			return {
				ok: true as const,
				value: {
					returnValue: payloadReturnValue(payload.id, DEFAULT_OPEN_RESULT),
				},
			};
		}) as never);
		const result = await context.job.run(plan);
		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "recording-failed",
		});
		expect(startAttempts).toBe(1);
		expect(context.session.quit).toHaveBeenCalledOnce();
	});

	it("sends the recorder configuration to the Play Mode stage payload", async () => {
		const { job, evalCalls, evalSources } = setup();
		await job.run(plan);
		const startSource = evalSources[evalCalls.indexOf("start-recording")];
		expect(startSource).toContain("mov-prores");
		// Recorder には staging パスのみを渡し、最終パスは触らせない
		expect(startSource).toContain("Intro_1.urc-partial.mp4");
		expect(startSource).not.toContain(
			'absolutePath\\":\\"C:\\\\renders\\\\Intro_1.mp4',
		);
		expect(startSource).toContain("1920");
		const setupSource = evalSources[evalCalls.indexOf("setup-recorder")];
		expect(setupSource).toContain("scene-Intro.status.json");
	});

	it("resets the stale status file before the setup eval", async () => {
		const context = setup();
		const order: string[] = [];
		context.status.reset.mockImplementation((async () => {
			order.push("reset");
		}) as never);
		context.pipeline.eval.mockImplementation((async (payload: {
			id: string;
		}) => {
			order.push(payload.id);
			return {
				ok: true as const,
				value: {
					returnValue: payloadReturnValue(payload.id, DEFAULT_OPEN_RESULT),
				},
			};
		}) as never);
		await context.job.run(plan);
		expect(order.indexOf("reset")).toBeLessThan(
			order.indexOf("setup-recorder"),
		);
	});

	it("publishes the outputs only after validation succeeds", async () => {
		const context = setup();
		const order: string[] = [];
		context.status.poll.mockImplementation((async () => {
			order.push("poll");
			return {
				ok: true as const,
				value: { state: "completed" as const, timelineDurationSec: 2 },
			};
		}) as never);
		context.promote.mockImplementation((async () => {
			order.push("promote");
		}) as never);
		const result = await context.job.run(plan);
		expect(result.outcome).toBe("success");
		expect(order).toEqual(["poll", "promote"]);
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

	it("never deletes the final outputs on failure, only the staging files", async () => {
		const context = setup();
		context.status.poll.mockResolvedValue({
			ok: false as const,
			error: { kind: "recording-timeout" as const, message: "timeout" },
		} as never);
		const result = await context.job.run(plan);
		expect(result.outcome).toBe("failure");
		// 既存の同名出力は staging 方式によりそもそも touch されない
		expect(context.promote).not.toHaveBeenCalled();
		const cleanedPaths = context.cleanup.mock.calls.flatMap(
			(call) => (call as unknown as [readonly string[]])[0],
		);
		expect(cleanedPaths).not.toContain("C:\\renders\\Intro_1.mp4");
		expect(cleanedPaths).not.toContain("C:\\renders\\Intro_1.mov");
		expect(context.cleanup).toHaveBeenLastCalledWith(
			[
				"C:\\renders\\Intro_1.urc-partial.mp4",
				"C:\\renders\\Intro_1.urc-partial.mov",
			],
			false,
		);
	});

	it("keeps published outputs when the post-recording hook fails", async () => {
		const context = setup();
		context.runHooks.mockResolvedValue({
			ok: false as const,
			error: { message: "hook exploded" },
		} as never);
		const result = await context.job.run(plan);
		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "hook-failed",
			outputs: [
				{ format: "mp4", videoPath: "C:\\renders\\Intro_1.mp4" },
				{ format: "mov-prores", videoPath: "C:\\renders\\Intro_1.mov" },
			],
		});
		expect(context.promote).toHaveBeenCalledOnce();
		expect(context.cleanup).toHaveBeenLastCalledWith([], false);
	});

	it("removes RecorderTracks before the recorder setup and backs them up", async () => {
		const context = setup();
		const registerBackups = vi.fn(async (_paths: readonly string[]) => ({
			ok: true as const,
			value: undefined,
		}));
		const found = {
			ok: true,
			mode: "scan",
			timelines: [
				{
					assetPath: "Assets/Timelines/Intro.playable",
					chain: "root",
					tracks: ["Recorder Track"],
				},
			],
			removed: 0,
			timelineDurationSec: 2,
			timelineFrameRate: 30,
			warnings: [],
		};
		const order: string[] = [];
		context.pipeline.eval.mockImplementation((async (payload: {
			id: string;
		}) => {
			order.push(payload.id);
			if (payload.id === "recorder-tracks")
				return {
					ok: true as const,
					value: {
						returnValue: JSON.stringify(
							order.filter((id) => id === "recorder-tracks").length === 1
								? found
								: { ...found, mode: "remove", removed: 1 },
						),
					},
				};
			return {
				ok: true as const,
				value: {
					returnValue: payloadReturnValue(payload.id, DEFAULT_OPEN_RESULT),
				},
			};
		}) as never);
		const job = createSceneJob({
			session: context.session,
			pipeline: context.pipeline,
			statusChannel: () => context.status as StatusChannel,
			registerBackups,
			validate: vi.fn(async (paths) => paths),
			planOutputs: vi.fn(async () => [
				{
					format: "mp4" as const,
					path: "C:\\renders\\Intro_1.mp4",
					stagingPath: "C:\\renders\\Intro_1.urc-partial.mp4",
				},
			]),
			cleanup: context.cleanup,
			promote: context.promote,
			runHooks: context.runHooks,
			sleep: context.sleep,
		});

		const result = await job.run(plan);

		expect(result.outcome).toBe("success");
		expect(registerBackups).toHaveBeenCalledWith([
			"Assets/Timelines/Intro.playable",
		]);
		// 走査・削除ともに、録画設定を組む setup-recorder より前に済ませる
		expect(order).toEqual([
			"open-scene",
			"recorder-tracks",
			"recorder-tracks",
			"setup-recorder",
			"start-recording",
		]);
		expect(result.warnings).toContainEqual(
			expect.stringContaining("RecorderTrack を一時的に外しました"),
		);
	});

	it("fails the scene when the RecorderTrack cleanup fails", async () => {
		const context = setup();
		context.pipeline.eval.mockImplementation((async (payload: {
			id: string;
		}) => {
			if (payload.id === "recorder-tracks")
				return {
					ok: true as const,
					value: {
						returnValue: JSON.stringify({
							ok: false,
							error:
								"RecorderTrack type was not found; com.unity.recorder is missing or its API changed",
						}),
					},
				};
			return {
				ok: true as const,
				value: {
					returnValue: payloadReturnValue(payload.id, DEFAULT_OPEN_RESULT),
				},
			};
		}) as never);

		const result = await context.job.run(plan);

		// 掃除できないまま録ると、Timeline 側の Recorder と二重に書き出される
		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "recorder-track-cleanup-failed",
		});
		expect(context.session.quit).toHaveBeenCalledOnce();
	});

	it("propagates a failed kill from the launch timeout path", async () => {
		const context = setup();
		context.session.start.mockResolvedValue({
			ok: false as const,
			error: {
				kind: "connect-timeout" as const,
				message: "connect timeout",
				terminationFailed: true,
			},
		} as never);
		const result = await context.job.run(plan);
		expect(result).toMatchObject({
			outcome: "failure",
			failureReason: "connect-timeout",
			editorTerminationFailed: true,
		});
	});

	it("flags a failed Editor termination so the batch can abort", async () => {
		const context = setup();
		context.session.quit.mockRejectedValue(
			new Error("Unity Editor (PID 1234) の強制終了に失敗しました") as never,
		);
		const result = await context.job.run(plan);
		// Scene 自体は成功しているが、生存 Editor をバッチへ伝える
		expect(result.outcome).toBe("success");
		expect(result.editorTerminationFailed).toBe(true);
	});
});
