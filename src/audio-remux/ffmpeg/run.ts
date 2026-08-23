import { spawn } from "node:child_process";
import { stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { OutputFormat } from "../../config/schema.js";
import { err, ok, type Result } from "../../shared/types.js";
import { codecArgsFor } from "./codec-matrix.js";
import type { FilterGraph } from "./filter-graph.js";

export type MuxError = {
	readonly kind: "spawn-failed" | "nonzero-exit" | "timeout" | "output-invalid";
	readonly exitCode?: number;
	readonly stderrTail: string;
};

export interface MuxRequest {
	readonly ffmpegPath: string;
	readonly videoPath: string;
	readonly outputTmpPath: string;
	readonly graph: FilterGraph;
	readonly format: OutputFormat;
	readonly timeoutSec: number;
	readonly debug: boolean;
	/** Test and wrapper support; production callers leave these unset. */
	readonly commandPrefix?: readonly string[];
	readonly env?: NodeJS.ProcessEnv;
	readonly logger?: (message: string) => void;
}

export interface MuxRunner {
	runMux(request: MuxRequest): Promise<Result<void, MuxError>>;
}

export function calculateMuxTimeoutSec(
	inPointSec: number,
	outPointSec: number,
): number {
	return Math.ceil(Math.max(0, outPointSec - inPointSec) * 2) + 120;
}

function quoteArg(value: string): string {
	return /[\s"]/.test(value) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

function stderrTail(stderr: string): string {
	return stderr.slice(-4_096).trimEnd();
}

function commandArgs(request: MuxRequest, scriptPath: string): string[] {
	return [
		"-y",
		"-i",
		request.videoPath,
		...request.graph.inputArgs,
		"-filter_complex_script",
		scriptPath,
		"-map",
		"0:v:0",
		"-map",
		request.graph.mixLabel,
		"-c:v",
		"copy",
		...codecArgsFor(request.format),
		request.outputTmpPath,
	];
}

async function outputIsValid(path: string): Promise<boolean> {
	try {
		const info = await stat(path);
		return info.isFile() && info.size > 0;
	} catch {
		return false;
	}
}

export async function runMux(
	request: MuxRequest,
): Promise<Result<void, MuxError>> {
	const sessionDir = dirname(request.outputTmpPath);
	const scriptPath = join(sessionDir, "audio-mix.filter");
	const logPath = join(sessionDir, `ffmpeg-${request.format}.log`);
	const args = commandArgs(request, scriptPath);
	const commandLine = [
		request.ffmpegPath,
		...(request.commandPrefix ?? []),
		...args,
	]
		.map(quoteArg)
		.join(" ");

	try {
		await writeFile(scriptPath, request.graph.script, "utf8");
	} catch (cause) {
		return err({
			kind: "spawn-failed",
			stderrTail: cause instanceof Error ? cause.message : String(cause),
		});
	}

	const stderr: string[] = [];
	let timedOut = false;
	let spawnError: Error | undefined;
	const child = spawn(
		request.ffmpegPath,
		[...(request.commandPrefix ?? []), ...args],
		{
			env: { ...process.env, ...request.env },
			stdio: ["ignore", "ignore", "pipe"],
			windowsHide: true,
		},
	);
	child.stderr?.setEncoding("utf8");
	child.stderr?.on("data", (chunk: string) => stderr.push(chunk));

	const result = await new Promise<{ code: number | null }>((resolve) => {
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
		}, Math.max(0, request.timeoutSec) * 1_000);
		child.once("error", (cause) => {
			spawnError = cause;
			clearTimeout(timer);
			resolve({ code: null });
		});
		child.once("close", (code) => {
			clearTimeout(timer);
			resolve({ code });
		});
	});

	const completeStderr = stderr.join("");
	if (request.debug) {
		const log = `${commandLine}\n\n${completeStderr}`;
		(request.logger ?? ((message: string) => console.debug(message)))(log);
		try {
			await writeFile(logPath, log, "utf8");
		} catch {
			// Logging must not hide the actual mux result.
		}
	}

	if (spawnError)
		return err({
			kind: "spawn-failed",
			stderrTail: stderrTail(spawnError.message),
		});
	if (timedOut)
		return err({ kind: "timeout", stderrTail: stderrTail(completeStderr) });
	if (result.code !== 0)
		return err({
			kind: "nonzero-exit",
			exitCode: result.code ?? undefined,
			stderrTail: stderrTail(completeStderr),
		});
	if (!(await outputIsValid(request.outputTmpPath)))
		return err({
			kind: "output-invalid",
			stderrTail: stderrTail(completeStderr),
		});
	return ok(undefined);
}

export class DefaultMuxRunner implements MuxRunner {
	public runMux(request: MuxRequest): Promise<Result<void, MuxError>> {
		return runMux(request);
	}
}
