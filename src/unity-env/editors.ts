import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { err, ok, type Result } from "../shared/types.js";
import type { UnityVersion } from "./project-version.js";
import type { EnvError } from "./unity-cli.js";

const execFileAsync = promisify(execFile);
export interface EditorInstall {
	readonly version: UnityVersion;
	readonly executablePath: string;
}
const versionPattern = /\b(\d{4,5}\.\d+\.\d+(?:[abfp]\d+)?)\b/i;

export function parseEditorsOutput(
	output: string,
): Result<readonly EditorInstall[], EnvError> {
	const editors: EditorInstall[] = [];
	for (const line of output.split(/\r?\n/)) {
		const match = line.match(versionPattern);
		if (!match) continue;
		const version = match[1];
		if (!version) continue;
		const remainder = line
			.slice((match.index ?? 0) + match[0].length)
			.replace(/^\s*[|,:-]?\s*/, "")
			.trim()
			.replace(/^"|"$/g, "");
		if (!remainder || /^(location|path|installed)$/i.test(remainder)) continue;
		editors.push({
			version: { raw: version, major: Number(version.split(".")[0]) },
			executablePath: remainder,
		});
	}
	return editors.length > 0
		? ok(editors)
		: err({
				kind: "cli-exec-failed",
				message: "`unity editors -i` の出力を解析できませんでした",
			});
}

export async function listEditors(
	execute: () => Promise<{
		stdout: string;
		stderr: string;
		exitCode: number;
	}> = async () => {
		const result = await execFileAsync("unity", ["editors", "-i"], {
			windowsHide: true,
		});
		return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
	},
): Promise<Result<readonly EditorInstall[], EnvError>> {
	try {
		const result = await execute();
		if (result.exitCode !== 0)
			return err({
				kind: "cli-exec-failed",
				message:
					result.stderr.trim() ||
					`unity editors -i failed (exit code ${result.exitCode})`,
			});
		return parseEditorsOutput(result.stdout);
	} catch (cause) {
		return err({
			kind: "cli-exec-failed",
			message: `Unity Editor の列挙に失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}
}
