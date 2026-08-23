// Emits the REAL extract-audio eval payload (task 4.2) with parameters injected,
// so it can be sent to the spike Editor verbatim with `unity command eval_file`.
//
// This is the end-to-end check that the shipped payload actually compiles and
// runs against a real Timeline — the unit tests only pin the injected output,
// they never execute it inside Unity.
//
// Run with Bun (the template is imported as text, which is a Bun loader feature):
//   pnpm exec bun run spike/timeline-audio/tools/e2e-emit-payload.ts <outFile> <metadataFilePath> [scenePath] [sceneName]

import { writeFileSync } from "node:fs";
import { compileAudioExtractionPayload } from "../../../src/audio-remux/extract/payload.js";

const [outFile, metadataFilePath, scenePath, sceneName] = process.argv.slice(2);
if (!outFile || !metadataFilePath) {
	console.error(
		"usage: e2e-emit-payload.ts <outFile> <metadataFilePath> [scenePath] [sceneName]",
	);
	process.exit(2);
}

const payload = compileAudioExtractionPayload({
	scenePath: scenePath ?? "Assets/Scenes/AudioSpike.unity",
	metadataFilePath,
	sceneName: sceneName ?? "AudioSpike",
});

writeFileSync(outFile, payload.source, "utf8");
console.log(`wrote ${payload.source.length} chars to ${outFile}`);
