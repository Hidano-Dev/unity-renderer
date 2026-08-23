import { injectParams } from "../../csharp-payloads/compile.js";
import type { JsonValue } from "../../shared/types.js";
import extractAudioTemplate from "./templates/extract-audio.cs" with {
	type: "text",
};

export interface AudioExtractionPayloadParams {
	readonly scenePath: string;
	readonly metadataFilePath: string;
	readonly sceneName: string;
}

export interface AudioExtractionPayload {
	readonly source: string;
}

export function compileAudioExtractionPayload(
	params: AudioExtractionPayloadParams,
): AudioExtractionPayload {
	return {
		source: injectParams(
			extractAudioTemplate,
			params as unknown as Record<string, JsonValue>,
		),
	};
}

export const createAudioExtractionPayload = compileAudioExtractionPayload;
