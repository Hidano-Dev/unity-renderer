import { injectParams } from "../../csharp-payloads/compile.js";
import type { JsonValue } from "../../shared/types.js";
import extractAudioTemplate from "./templates/extract-audio.cs" with {
	type: "text",
};

export interface AudioExtractionPayloadParams {
	/**
	 * 抽出対象として期待する Scene 名。ペイロードは Scene を開き直さず
	 * アクティブ Scene を読むため、これは取り違え防止の照合にのみ使う。
	 */
	readonly sceneName: string;
	readonly metadataFilePath: string;
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
