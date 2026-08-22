import { mkdir, rename, unlink, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import type { CompiledPayload } from "../csharp-payloads/compile.js";
import { err, ok, type Result } from "../shared/types.js";

const RETRIES = 3;
const RETRY_DELAY_MS = 2_000;

export type EvalTransport =
	| { readonly kind: "file" }
	| { readonly kind: "inline" }
	| { readonly kind: "inline-split" };

export interface EvalOptions {
	readonly timeoutSec: number;
	readonly transport: EvalTransport;
}

export interface PipelineError {
	readonly kind: "eval-failed" | "eval-transport-failed" | "eval-timeout";
	readonly message: string;
	readonly payloadId: string;
	readonly cause?: unknown;
}

export type EvalResult = Result<
	{ readonly returnValue: string },
	PipelineError
>;

export interface PipelineCommandResult {
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}

export interface PipelineClientDependencies {
	readonly projectPath: string;
	readonly sessionDir: string;
	readonly debug?: boolean;
	readonly execute?: (
		command: string,
		args: readonly string[],
		options: { readonly windowsHide: boolean },
	) => Promise<PipelineCommandResult>;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly log?: (message: string) => void;
}

export interface PipelineClient {
	eval(payload: CompiledPayload, options: EvalOptions): Promise<EvalResult>;
}

async function defaultExecute(
	command: string,
	args: readonly string[],
	options: { readonly windowsHide: boolean },
): Promise<PipelineCommandResult> {
	const { execFile } = await import("node:child_process");
	const { promisify } = await import("node:util");
	try {
		const result = await promisify(execFile)(command, [...args], options);
		return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
	} catch (cause) {
		const failure = cause as {
			stdout?: string;
			stderr?: string;
			code?: number;
		};
		if (typeof failure.code === "number") {
			return {
				stdout: failure.stdout ?? "",
				stderr: failure.stderr ?? "",
				exitCode: failure.code,
			};
		}
		throw cause;
	}
}

const defaultSleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function responseResult(stdout: string): {
	success: boolean;
	value?: string;
	error?: string;
} {
	const parsed: unknown = JSON.parse(stdout);
	if (!parsed || typeof parsed !== "object")
		throw new Error("Invalid pipeline response");
	const root = parsed as { result?: unknown; data?: { result?: unknown } };
	const result = root.result ?? root.data?.result;
	if (!result || typeof result !== "object")
		throw new Error("Invalid pipeline result");
	const value = (result as { result?: unknown }).result;
	return {
		success: (result as { success?: unknown }).success === true,
		value: value === undefined ? undefined : String(value),
		error:
			typeof (result as { error?: unknown }).error === "string"
				? (result as { error: string }).error
				: undefined,
	};
}

export function createPipelineClient(
	dependencies: PipelineClientDependencies,
): PipelineClient {
	const execute = dependencies.execute ?? defaultExecute;
	const sleep = dependencies.sleep ?? defaultSleep;
	const log = dependencies.log ?? (() => undefined);
	let sequence = 0;

	return {
		async eval(payload, options) {
			const id = `${payload.id}-${++sequence}`;
			const startedAt = new Date().toISOString();
			let filePath: string | undefined;
			let tempPath: string | undefined;
			try {
				let args: string[];
				if (options.transport.kind === "file") {
					await mkdir(dependencies.sessionDir, { recursive: true });
					const finalPath = join(dependencies.sessionDir, `payload-${id}.cs`);
					tempPath = `${finalPath}.${process.pid}.tmp`;
					await writeFile(tempPath, payload.source, "utf8");
					await rename(tempPath, finalPath);
					filePath = finalPath;
					args = [
						"command",
						"eval_file",
						"--project-path",
						dependencies.projectPath,
						finalPath,
					];
				} else {
					args = [
						"command",
						"eval",
						"--project-path",
						dependencies.projectPath,
						payload.source,
					];
				}
				args.push(
					"--timeout",
					String(Math.round(options.timeoutSec * 1_000)),
					"--format",
					"json",
				);
				log(
					`[eval ${startedAt}] id=${id} size=${Buffer.byteLength(payload.source)} transport=${options.transport.kind}`,
				);

				let response: PipelineCommandResult | undefined;
				let lastCause: unknown;
				for (let attempt = 1; attempt <= RETRIES; attempt++) {
					try {
						response = await execute("unity", args, { windowsHide: true });
						break;
					} catch (cause) {
						lastCause = cause;
						if (attempt === RETRIES) break;
						await sleep(RETRY_DELAY_MS);
					}
				}
				if (!response) {
					return err({
						kind: "eval-transport-failed",
						payloadId: payload.id,
						message: "Unity Pipeline への接続に失敗しました",
						cause: lastCause,
					});
				}
				log(
					`[eval ${new Date().toISOString()}] id=${id} status=${response.exitCode} response=${response.stdout || response.stderr}`,
				);
				let parsed: ReturnType<typeof responseResult>;
				try {
					parsed = responseResult(response.stdout);
				} catch (cause) {
					return err({
						kind: response.exitCode === 124 ? "eval-timeout" : "eval-failed",
						payloadId: payload.id,
						message: "Unity Pipeline の応答を解釈できません",
						cause,
					});
				}
				if (response.exitCode !== 0 || !parsed.success) {
					return err({
						kind: response.exitCode === 124 ? "eval-timeout" : "eval-failed",
						payloadId: payload.id,
						message:
							parsed.error ??
							(response.stderr || "C# eval の実行に失敗しました"),
					});
				}
				return ok({ returnValue: parsed.value ?? "" });
			} finally {
				if (tempPath && !dependencies.debug)
					await unlink(tempPath).catch(() => undefined);
				if (filePath && !dependencies.debug)
					await unlink(filePath).catch(() => undefined);
				if (dependencies.debug && filePath)
					log(`[eval] retained ${basename(filePath)}`);
			}
		},
	};
}
