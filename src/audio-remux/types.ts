import type { OutputFormat } from "../config/schema.js";

export type AudioFailureCategory = "extract" | "ffmpeg-acquire" | "mux";

export interface OutputMuxStatus {
	readonly format: OutputFormat;
	readonly videoPath: string;
	readonly outcome: "success" | "failure" | "skipped";
	readonly errorDetail?: string;
}

export class AudioRemuxHookError extends Error {
	readonly category: AudioFailureCategory;
	readonly sceneName: string;
	readonly preservedVideoPaths: readonly string[];
	readonly outputs: readonly OutputMuxStatus[];

	public constructor(options: {
		category: AudioFailureCategory;
		sceneName: string;
		message: string;
		preservedVideoPaths: readonly string[];
		outputs: readonly OutputMuxStatus[];
	}) {
		super(`[audio-remux:${options.category}] ${options.message}`);
		this.name = "AudioRemuxHookError";
		this.category = options.category;
		this.sceneName = options.sceneName;
		this.preservedVideoPaths = options.preservedVideoPaths;
		this.outputs = options.outputs;
	}
}
