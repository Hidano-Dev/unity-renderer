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
