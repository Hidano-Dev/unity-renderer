// End-to-end check for task 6.2's offline / manual-placement scenarios, run
// against the REAL FfmpegAcquireManager (not the unit-test mocks).
//
//   pnpm exec bun run spike/timeline-audio/tools/e2e-ffmpeg-acquire.ts \
//     --tools <emptyToolsDir> --scenario offline|manual [--ffmpeg <ffmpeg.exe>]
//
// offline : the fetch is made to fail the way a disconnected machine does, and
//           the resulting error is printed so the operator guidance (source URL
//           + absolute manual path) can be checked.
// manual  : an ffmpeg.exe is placed in the manual directory first; the manager
//           must use it, report source="manual", and never touch the network.

import { copyFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { createFfmpegAcquireManager } from "../../../src/audio-remux/ffmpeg/acquire.js";

function arg(name: string, fallback?: string): string {
	const index = process.argv.indexOf(`--${name}`);
	if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
	if (fallback !== undefined) return fallback;
	throw new Error(`missing required argument --${name}`);
}

const toolsDirectory = arg("tools");
const scenario = arg("scenario");
mkdirSync(toolsDirectory, { recursive: true });

let networkCalls = 0;

if (scenario === "manual") {
	const manualDirectory = join(toolsDirectory, "manual");
	mkdirSync(manualDirectory, { recursive: true });
	copyFileSync(arg("ffmpeg"), join(manualDirectory, "ffmpeg.exe"));
}

const manager = createFfmpegAcquireManager({
	toolsDirectory,
	fetch: async (url: string) => {
		networkCalls += 1;
		if (scenario === "manual")
			throw new Error(
				"network was used in the manual scenario, which must not happen",
			);
		// What a disconnected machine actually produces from fetch().
		throw new TypeError(`fetch failed: ${url}`);
	},
});

const result = await manager.ensureFfmpeg();

console.log(`scenario     : ${scenario}`);
console.log(`network calls: ${networkCalls}`);
if (result.ok) {
	console.log(`RESULT       : ok`);
	console.log(`  ffmpegPath : ${result.value.ffmpegPath}`);
	console.log(`  source     : ${result.value.source}`);
} else {
	console.log(`RESULT       : failed`);
	console.log(`  kind       : ${result.error.kind}`);
	console.log(`  message    : ${result.error.message}`);
	console.log(`  manual hint: ${result.error.manualInstallHint}`);
	process.exitCode = 1;
}
