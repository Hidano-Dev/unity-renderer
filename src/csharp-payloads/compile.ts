import type { JsonValue } from "../shared/types.js";
import openSceneTemplate from "./templates/open-scene.cs" with { type: "text" };
import quitEditorTemplate from "./templates/quit-editor.cs" with {
	type: "text",
};
import setupRecorderTemplate from "./templates/setup-recorder.cs" with {
	type: "text",
};
import startRecordingTemplate from "./templates/start-recording.cs" with {
	type: "text",
};

/** @impl URC-8.1 @impl URC-9.1 @impl URC-10.1 @impl URC-11.1 */

export type PayloadId =
	| "open-scene"
	| "setup-recorder"
	| "start-recording"
	| "quit-editor";

export interface CompiledPayload {
	readonly id: PayloadId;
	readonly source: string;
}

export interface PayloadCompiler {
	compile(id: PayloadId, params: Record<string, JsonValue>): CompiledPayload;
}

export const PARAMS_PLACEHOLDER = "/*__PARAMS_JSON__*/";

export const payloadTemplates: Readonly<Record<PayloadId, string>> = {
	"open-scene": openSceneTemplate,
	"setup-recorder": setupRecorderTemplate,
	"start-recording": startRecordingTemplate,
	"quit-editor": quitEditorTemplate,
};

function encodeParams(params: Record<string, JsonValue>): string {
	const json = JSON.stringify(params);
	if (json === undefined) {
		throw new TypeError("Payload parameters must be JSON serializable");
	}

	// The first encoding creates JSON; the second creates a valid C# string
	// literal containing that JSON. No C# source is assembled from parameters.
	return JSON.stringify(json);
}

export function compilePayload(
	id: PayloadId,
	params: Record<string, JsonValue>,
): CompiledPayload {
	const template = payloadTemplates[id];
	if (template === undefined) {
		throw new Error(`Unknown payload template: ${id}`);
	}

	const occurrences = template.split(PARAMS_PLACEHOLDER).length - 1;
	if (occurrences !== 1) {
		throw new Error(
			`Payload template ${id} must contain exactly one ${PARAMS_PLACEHOLDER} placeholder`,
		);
	}

	return {
		id,
		source: template.replace(PARAMS_PLACEHOLDER, encodeParams(params)),
	};
}

export function createPayloadCompiler(): PayloadCompiler {
	return { compile: compilePayload };
}
