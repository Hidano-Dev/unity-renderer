import { access, constants } from "node:fs/promises";
import type { HookContext } from "../../hooks/registry.js";
import { err, ok, type Result } from "../../shared/types.js";
import { compileAudioExtractionPayload } from "./payload.js";

/** @impl TAR-2.4 @impl TAR-2.5 @impl TAR-8.2 @impl TAR-8.4 @impl TAR-10.2 */

export const AUDIO_EXTRACTION_TIMEOUT_SEC = 120;

export type ExtractError =
	| {
			readonly kind: "eval-failed";
			readonly message: string;
			readonly cause?: unknown;
	  }
	| {
			readonly kind: "eval-timeout";
			readonly message: string;
			readonly cause?: unknown;
	  }
	| {
			readonly kind: "output-missing";
			readonly message: string;
			readonly cause?: unknown;
	  }
	| {
			readonly kind: "payload-reported-failure";
			readonly message: string;
			readonly cause?: unknown;
	  };

function errorMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

function payloadFailure(returnValue: string): string | undefined {
	try {
		const result: unknown = JSON.parse(returnValue);
		if (!result || typeof result !== "object")
			return "extraction payload returned an invalid result";
		const record = result as { ok?: unknown; error?: unknown };
		if (record.ok === false)
			return typeof record.error === "string"
				? record.error
				: "extraction payload reported failure";
		if (record.ok !== true)
			return "extraction payload returned an invalid result";
		return undefined;
	} catch (cause) {
		return `extraction payload returned invalid JSON: ${errorMessage(cause)}`;
	}
}

async function outputExists(metadataFilePath: string): Promise<boolean> {
	try {
		await access(metadataFilePath, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

/** extract-audio.cs を実行し、atomic write 済み JSON の存在まで確認する。 */
export async function runAudioExtraction(
	ctx: HookContext,
	metadataFilePath: string,
): Promise<Result<void, ExtractError>> {
	ctx.logger.debug("[audio-remux:extract] starting audio metadata extraction");
	const payload = compileAudioExtractionPayload({
		metadataFilePath,
		sceneName: ctx.handoff.sceneName,
	});

	const evaluated = await ctx.evalCSharp(
		payload.source,
		AUDIO_EXTRACTION_TIMEOUT_SEC,
	);
	if (!evaluated.ok) {
		const kind =
			evaluated.error.kind === "eval-timeout" ? "eval-timeout" : "eval-failed";
		const failure: ExtractError = {
			kind,
			message: `[audio-remux:extract] ${evaluated.error.message}`,
			cause: evaluated.error,
		};
		ctx.logger.warn(failure.message);
		return err(failure);
	}

	const reportedFailure = payloadFailure(evaluated.value.returnValue);
	if (reportedFailure) {
		const failure: ExtractError = {
			kind: "payload-reported-failure",
			message: `[audio-remux:extract] ${reportedFailure}`,
		};
		ctx.logger.warn(failure.message);
		return err(failure);
	}

	if (!(await outputExists(metadataFilePath))) {
		const failure: ExtractError = {
			kind: "output-missing",
			message: `[audio-remux:extract] extraction completed without output: ${metadataFilePath}`,
		};
		ctx.logger.warn(failure.message);
		return err(failure);
	}

	ctx.logger.debug("[audio-remux:extract] audio metadata extraction completed");
	return ok(undefined);
}

export interface ExtractService {
	runExtraction(
		ctx: HookContext,
		metadataFilePath: string,
	): Promise<Result<void, ExtractError>>;
}

export const createExtractService = (): ExtractService => ({
	runExtraction: runAudioExtraction,
});
