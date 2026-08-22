import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, type Result } from "../shared/types.js";

const execFileAsync = promisify(execFile);

export interface EnvError {
	readonly kind:
		| "cli-not-found"
		| "cli-exec-failed"
		| "unsupported-unity-version"
		| "editor-not-found"
		| "install-declined"
		| "install-failed"
		| "project-version-unreadable";
	readonly message: string;
	readonly cause?: unknown;
}

export type CliExecutor = () => Promise<{
	stdout: string;
	stderr: string;
	exitCode: number;
}>;

export async function detectUnityCli(
	execute: CliExecutor = defaultExecutor,
): Promise<Result<{ readonly cliVersion: string }, EnvError>> {
	try {
		const result = await execute();
		if (result.exitCode !== 0) {
			return err({
				kind: "cli-exec-failed",
				message: `Unity CLI の実行に失敗しました: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
			});
		}
		const cliVersion = result.stdout.trim().split(/\r?\n/)[0]?.trim();
		if (!cliVersion)
			return err({
				kind: "cli-exec-failed",
				message: "Unity CLI のバージョン情報を取得できませんでした",
			});
		return ok({ cliVersion });
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		const missing =
			code === "ENOENT" ||
			(cause instanceof Error && cause.message.includes("ENOENT"));
		return err({
			kind: missing ? "cli-not-found" : "cli-exec-failed",
			message: missing
				? "Unity CLI (unity) が見つかりません。Unity CLI をセットアップし、`unity auth login` を実行してください。"
				: `Unity CLI の実行に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}
}

async function defaultExecutor(): Promise<{
	stdout: string;
	stderr: string;
	exitCode: number;
}> {
	try {
		const result = await execFileAsync("unity", ["--version"], {
			windowsHide: true,
		});
		return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
	} catch (cause) {
		const failure = cause as {
			stdout?: string;
			stderr?: string;
			code?: number | string;
		};
		if (typeof failure.code === "number")
			return {
				stdout: failure.stdout ?? "",
				stderr: failure.stderr ?? "",
				exitCode: failure.code,
			};
		throw cause;
	}
}
