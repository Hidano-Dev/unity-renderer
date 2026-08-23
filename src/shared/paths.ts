import { realpath } from "node:fs/promises";
import path from "node:path";
import { type CommonError, err, ok, type Result } from "./types.js";

/** @impl URC-13.2 */
export const TOOL_NAME = "unity-render-core";
export const SESSION_DIRECTORY_NAME = "sessions";

export interface PathOptions {
	readonly env?: NodeJS.ProcessEnv;
	readonly toolName?: string;
}

function localAppDataError(): CommonError {
	return {
		category: "environment",
		code: "localappdata-unavailable",
		message: "LOCALAPPDATA is not set",
	};
}

export function resolveToolDirectory(
	options: PathOptions = {},
): Result<string, CommonError> {
	const localAppData =
		options.env === undefined
			? process.env.LOCALAPPDATA
			: options.env.LOCALAPPDATA;
	if (!localAppData) return err(localAppDataError());

	return ok(path.win32.join(localAppData, options.toolName ?? TOOL_NAME));
}

export function resolveSessionDirectory(
	options: PathOptions = {},
): Result<string, CommonError> {
	const toolDirectory = resolveToolDirectory(options);
	return toolDirectory.ok
		? ok(path.win32.join(toolDirectory.value, SESSION_DIRECTORY_NAME))
		: toolDirectory;
}

export const resolveToolOwnedDirectory = resolveToolDirectory;

/**
 * プロジェクトの同一性キーを求める。`path.resolve` は junction / symlink /
 * ドライブ文字の大小違いを畳み込まないため、同じプロジェクトを別名パスで
 * 指定した 2 つの実行が別セッションとみなされ、同じ manifest を同時に
 * 変更し得る。ロックのハッシュ、session.json の保存値、比較のすべてで
 * この値を使う。
 *
 * realpath は対象が存在しない場合に失敗するため、その場合は resolve に
 * フォールバックする(存在しないプロジェクトは後続の検査が弾く)。
 */
export async function canonicalProjectPath(
	projectPath: string,
	options: { readonly realpath?: (target: string) => Promise<string> } = {},
): Promise<string> {
	const resolveReal = options.realpath ?? realpath;
	let canonical: string;
	try {
		canonical = await resolveReal(path.resolve(projectPath));
	} catch {
		canonical = path.resolve(projectPath);
	}
	// Windows のファイル名は大文字小文字を区別しない。ドライブ文字の大小違いは
	// realpath でも残るため、比較キーとしては正規化する
	return process.platform === "win32" ? canonical.toLowerCase() : canonical;
}
