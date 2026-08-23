import { readFile } from "node:fs/promises";
import { err, ok, type Result } from "../shared/types.js";
import type { ConfigError } from "./schema.js";
import { type RenderConfig, validateRenderConfig } from "./schema.js";

export const DEFAULT_EDITOR_START_TIMEOUT_SEC = 600;
export const DEFAULT_EDITOR_QUIT_TIMEOUT_SEC = 60;
export const RECORDING_TIMEOUT_FACTOR = 3;
export const RECORDING_TIMEOUT_MARGIN_SEC = 180;

/** @impl URC-2.1 @impl URC-2.2 @impl URC-2.4 @impl URC-10.6 @impl URC-15.3 */
export async function loadConfig(
	filePath: string,
): Promise<Result<RenderConfig, ConfigError>> {
	let contents: string;
	try {
		contents = await readFile(filePath, "utf8");
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		if (code === "ENOENT") {
			return err({
				kind: "not-found",
				issues: [
					{ path: "$", message: `configuration file not found: ${filePath}` },
				],
			});
		}
		return err({
			kind: "parse-error",
			issues: [
				{
					path: "$",
					message: `configuration file could not be read: ${filePath}`,
				},
			],
		});
	}

	let input: unknown;
	try {
		// Windows のエディタ・PowerShell は BOM 付き UTF-8 を書くことがある
		input = JSON.parse(contents.replace(/^\uFEFF/u, "")) as unknown;
	} catch (cause) {
		const message = cause instanceof Error ? cause.message : "invalid JSON";
		return err({ kind: "parse-error", issues: [{ path: "$", message }] });
	}

	const validated = validateRenderConfig(input);
	if (!validated.ok) return validated;

	return ok({
		...validated.value,
		debug: validated.value.debug ?? false,
		timeouts: {
			...validated.value.timeouts,
			editorStartSec:
				validated.value.timeouts?.editorStartSec ??
				DEFAULT_EDITOR_START_TIMEOUT_SEC,
			editorQuitSec:
				validated.value.timeouts?.editorQuitSec ??
				DEFAULT_EDITOR_QUIT_TIMEOUT_SEC,
		},
	});
}

/** Timeline duration is supplied after the Scene has been opened in the Editor. */
export function resolveRecordingTimeoutSec(
	config: Partial<RenderConfig>,
	recordDurationSec: number,
): number {
	const override = config.timeouts?.recordingSec;
	if (override !== undefined) return override;
	if (!Number.isFinite(recordDurationSec) || recordDurationSec < 0) {
		throw new RangeError(
			"recordDurationSec must be a finite, non-negative number",
		);
	}
	return (
		Math.ceil(recordDurationSec * RECORDING_TIMEOUT_FACTOR) +
		RECORDING_TIMEOUT_MARGIN_SEC
	);
}
