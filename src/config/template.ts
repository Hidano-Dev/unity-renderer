import { renderConfigSchema } from "./schema.js";

/** @impl URC-15.3 */
export function generateTemplate(): string {
	const template = {
		projectPath: "C:\\path\\to\\unity-project",
		scenes: ["SampleScene"],
		resolution: { width: 1920, height: 1080 },
		frameRate: 30,
		formats: ["mp4", "mov-prores"],
		output: {
			directory: "C:\\path\\to\\renders",
			fileName: "<Scene>_<Take>",
		},
		debug: false,
		timeouts: {
			editorStartSec: 600,
			editorQuitSec: 60,
		},
	};

	// Keep this invariant local so future template edits cannot produce an invalid init file.
	const validated = renderConfigSchema.parse(template);
	return `${JSON.stringify(validated, null, 2)}\n`;
}
