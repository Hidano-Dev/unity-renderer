// End-to-end driver for task 6.1 / 6.2: runs the SHIPPED audio-remux hook
// against a real Unity Editor (via `unity command eval_file`), a real ffmpeg
// binary, and real Recorder video output.
//
// Only two things are supplied by this driver rather than by the CLI:
//   - a HookContext whose evalCSharp shells out to the unity CLI (the CLI
//     normally provides this through the Pipeline client)
//   - an FfmpegProvider pointing at an already-downloaded ffmpeg, so the E2E
//     does not re-download 146 MB on every run
// Everything else - extraction, validation, planning, filter graph, mux,
// finalize - is the real shipped code path.
//
// Run with Bun:
//   pnpm exec bun run spike/timeline-audio/tools/e2e-run.ts \
//     --project <unityProjectPath> --session <sessionDir> \
//     --ffmpeg <ffmpeg.exe> --mp4 <video.mp4> [--mov <video.mov>] \
//     [--in 0] [--out 21] [--fps 30]

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createAudioRemuxHooks } from "../../../src/audio-remux/index.js";
import { AudioRemuxHookError } from "../../../src/audio-remux/types.js";
import type { EvalResult } from "../../../src/editor-session/pipeline-client.js";
import type { HookContext } from "../../../src/hooks/registry.js";

const execFileAsync = promisify(execFile);

function arg(name: string, fallback?: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
	if (fallback !== undefined) return fallback;
	throw new Error(`missing required argument --${name}`);
}

const projectPath = arg("project");
const sessionDir = arg("session");
const ffmpegPath = arg("ffmpeg");
const mp4Path = arg("mp4");
const movPath = process.argv.includes("--mov") ? arg("mov") : undefined;
const inPoint = Number(arg("in", "0"));
const outPoint = Number(arg("out", "21"));
const fps = Number(arg("fps", "30"));

// The unity CLI takes the payload as a file, so each eval is staged to disk.
const { writeFileSync, mkdirSync } = await import("node:fs");
const { join } = await import("node:path");
mkdirSync(sessionDir, { recursive: true });

let evalCounter = 0;
async function evalCSharp(
	source: string,
	timeoutSec: number,
): Promise<EvalResult> {
	const payloadPath = join(sessionDir, `eval-${evalCounter++}.cs`);
	writeFileSync(payloadPath, source, "utf8");
	try {
		const { stdout } = await execFileAsync(
			"unity",
			[
				"command",
				"eval_file",
				"--project-path",
				projectPath,
				payloadPath,
				"--timeout",
				String(timeoutSec),
				"--format",
				"json",
			],
			{ maxBuffer: 64 * 1024 * 1024 },
		);
		const parsed = JSON.parse(stdout);
		if (!parsed.success) {
			return {
				ok: false,
				error: {
					kind: "eval-failed",
					message: JSON.stringify(parsed.errors ?? parsed),
				},
			} as EvalResult;
		}
		return {
			ok: true,
			value: { returnValue: String(parsed.data?.result?.result ?? "") },
		} as EvalResult;
	} catch (cause) {
		// The unity CLI exits non-zero on a failed eval but still prints the
		// diagnostic JSON on stdout, so surface it instead of just "Command failed".
		const withStreams = cause as { stdout?: string; stderr?: string };
		const payload = withStreams.stdout || withStreams.stderr || "";
		console.error(`EVAL FAILURE OUTPUT:\n${payload}`);
		return {
			ok: false,
			error: {
				kind: "eval-failed",
				message: payload || (cause instanceof Error ? cause.message : String(cause)),
			},
		} as EvalResult;
	}
}

const ctx: HookContext = {
	handoff: {
		sceneName: "AudioSpike",
		videoPath: mp4Path,
		videoFormat: "mp4",
		additionalOutputs: movPath
			? [{ format: "mov-prores" as const, videoPath: movPath }]
			: [],
		effectiveFrameRate: fps,
		inPoint,
		outPoint,
	},
	debug: true,
	sessionDir,
	evalCSharp,
	logger: {
		warn: (message: string) => console.warn(`WARN  ${message}`),
		debug: (message: string) => console.log(`DEBUG ${message}`),
	},
};

const { dirname } = await import("node:path");
const { existsSync } = await import("node:fs");
// ffprobe ships in the same bin directory; mirror what the real acquire
// manager resolves so the probing phase is exercised for real.
const ffprobeCandidate = join(dirname(ffmpegPath), "ffprobe.exe");
const ffprobePath = existsSync(ffprobeCandidate) ? ffprobeCandidate : undefined;

const hooks = createAudioRemuxHooks({
	// Skip the download: the spike already fetched and verified this binary.
	ffmpegProvider: {
		ensureFfmpeg: async () => ({
			ok: true as const,
			value: {
				ffmpegPath,
				...(ffprobePath ? { ffprobePath } : {}),
				source: "managed" as const,
			},
		}),
	},
});

try {
	await hooks.afterRecording?.(ctx);
	console.log("\nRESULT: ok");
} catch (error) {
	if (error instanceof AudioRemuxHookError) {
		console.error(`\nRESULT: failed category=${error.category}`);
		console.error(`  message : ${error.message}`);
		console.error(`  preserved: ${error.preservedVideoPaths.join(", ")}`);
		for (const output of error.outputs) {
			console.error(
				`  output  : ${output.format} ${output.outcome}${output.errorDetail ? ` - ${output.errorDetail}` : ""}`,
			);
		}
	} else {
		console.error("\nRESULT: failed (unexpected)", error);
	}
	process.exit(1);
}
