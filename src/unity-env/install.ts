import { execFile } from "node:child_process";
import { stdin, stdout } from "node:process";
import { createInterface } from "node:readline/promises";
import { promisify } from "node:util";
import { err, ok, type Result } from "../shared/types.js";
import { type EditorInstall, listEditors } from "./editors.js";
import type { UnityVersion } from "./project-version.js";
import type { EnvError } from "./unity-cli.js";

const execFileAsync = promisify(execFile);

export type InstallExecutor = () => Promise<{
	readonly stdout: string;
	readonly stderr: string;
	readonly exitCode: number;
}>;

export interface InstallFlowOptions {
	readonly listEditors?: () => Promise<
		Result<readonly EditorInstall[], EnvError>
	>;
	readonly install?: InstallExecutor;
	readonly confirmInstall?: (version: UnityVersion) => Promise<boolean>;
}

function sameVersion(left: UnityVersion, right: UnityVersion): boolean {
	return left.raw === right.raw;
}

function defaultInstall(required: UnityVersion): InstallExecutor {
	return async () => {
		try {
			const result = await execFileAsync("unity", ["install", required.raw], {
				windowsHide: true,
			});
			return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 };
		} catch (cause) {
			const failure = cause as {
				stdout?: string;
				stderr?: string;
				code?: number | string;
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
	};
}

async function defaultConfirmInstall(version: UnityVersion): Promise<boolean> {
	const prompt = createInterface({ input: stdin, output: stdout });
	try {
		const answer = await prompt.question(
			`Unity ${version.raw} が見つかりません。\`unity install\` でインストールしますか？ [y/N] `,
		);
		return /^(y|yes|はい)$/i.test(answer.trim());
	} finally {
		prompt.close();
	}
}

function declined(required: UnityVersion): Result<never, EnvError> {
	return err({
		kind: "install-declined",
		message: `Unity ${required.raw} がインストールされていないため処理を中断しました。Unity ${required.raw} をインストールして再実行してください。`,
	});
}

/**
 * Finds the exact project Editor and, when explicitly interactive, offers to install it.
 * This module deliberately has no project-path or project-file write access.
 */
export async function ensureEditor(
	required: UnityVersion,
	interactive: boolean,
	options: InstallFlowOptions = {},
): Promise<Result<EditorInstall, EnvError>> {
	const findEditors = options.listEditors ?? listEditors;
	const editors = await findEditors();
	if (!editors.ok) return editors;

	const existing = editors.value.find((editor) =>
		sameVersion(editor.version, required),
	);
	if (existing) return ok(existing);
	if (!interactive) return declined(required);

	const confirm = options.confirmInstall ?? defaultConfirmInstall;
	if (!(await confirm(required))) return declined(required);

	const install = options.install ?? defaultInstall(required);
	try {
		const result = await install();
		if (result.exitCode !== 0) {
			return err({
				kind: "install-failed",
				message: `Unity ${required.raw} のインストールに失敗しました: ${result.stderr.trim() || `exit code ${result.exitCode}`}`,
			});
		}
	} catch (cause) {
		return err({
			kind: "install-failed",
			message: `Unity ${required.raw} のインストールに失敗しました: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}

	const refreshed = await findEditors();
	if (!refreshed.ok) return refreshed;
	const installed = refreshed.value.find((editor) =>
		sameVersion(editor.version, required),
	);
	return installed
		? ok(installed)
		: err({
				kind: "install-failed",
				message: `Unity ${required.raw} のインストールは完了しましたが、Editor を検出できませんでした。Unity Hub の状態を確認して再実行してください。`,
			});
}
