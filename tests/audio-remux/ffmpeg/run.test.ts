import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	calculateMuxTimeoutSec,
	type MuxRequest,
	runMux,
} from "../../../src/audio-remux/ffmpeg/run.js";

const roots: string[] = [];

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "mux-runner-"));
	roots.push(root);
	const fake = join(root, "fake-ffmpeg.js");
	await writeFile(
		fake,
		[
			"const fs = require('node:fs');",
			"fs.writeFileSync(process.env.ARGV_FILE, JSON.stringify(process.argv.slice(2)));",
			"fs.writeFileSync(process.argv.at(-1), 'muxed');",
		].join("\n"),
	);
	return { root, fake };
}

function request(
	root: string,
	fake: string,
	overrides: Partial<MuxRequest> = {},
): MuxRequest {
	return {
		ffmpegPath: process.execPath,
		videoPath: join(root, "silent.mp4"),
		outputTmpPath: join(root, "output.audiotmp.mp4"),
		graph: {
			script: "[0:a]anull[mix]",
			inputArgs: ["-i", join(root, "audio.wav")],
			mixLabel: "[mix]",
		},
		format: "mp4",
		timeoutSec: 2,
		debug: false,
		...overrides,
		env: { ARGV_FILE: join(root, "argv.json") },
		commandPrefix: [fake],
	};
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("runMux", () => {
	it("runs a fake ffmpeg with the filter script and codec arguments", async () => {
		const { root, fake } = await fixture();
		await writeFile(join(root, "silent.mp4"), "video");
		await writeFile(join(root, "audio.wav"), "audio");
		const result = await runMux(request(root, fake));

		expect(result).toEqual({ ok: true, value: undefined });
		const args = JSON.parse(
			await readFile(join(root, "argv.json"), "utf8"),
		) as string[];
		expect(args).toEqual(
			expect.arrayContaining([
				"-y",
				"-i",
				join(root, "silent.mp4"),
				"-filter_complex_script",
				"-map",
				"0:v:0",
				"-map",
				"[mix]",
				"-c:v",
				"copy",
				"-c:a",
				"aac",
				join(root, "output.audiotmp.mp4"),
			]),
		);
		expect(await readFile(join(root, "audio-mix.filter"), "utf8")).toBe(
			"[0:a]anull[mix]",
		);
	});

	it("classifies nonzero exits and includes the stderr tail", async () => {
		const { root } = await fixture();
		const failing = join(root, "fail.js");
		await writeFile(
			failing,
			"console.error('failure details'); process.exit(7);",
		);
		const result = await runMux(request(root, failing));

		expect(result).toMatchObject({
			ok: false,
			error: {
				kind: "nonzero-exit",
				exitCode: 7,
				stderrTail: "failure details",
			},
		});
	});

	it("writes full command and stderr only in debug mode", async () => {
		const { root, fake } = await fixture();
		const logs: string[] = [];
		const result = await runMux(
			request(root, fake, {
				debug: true,
				logger: (message) => logs.push(message),
			}),
		);

		expect(result.ok).toBe(true);
		expect(
			logs.some((message) => message.includes("-filter_complex_script")),
		).toBe(true);
		expect(await readFile(join(root, "ffmpeg-mp4.log"), "utf8")).toContain(
			"-c:v copy",
		);
	});

	it("kills a process that exceeds the configured timeout", async () => {
		const { root } = await fixture();
		const hanging = join(root, "hanging.js");
		await writeFile(hanging, "setTimeout(() => {}, 10_000);");
		const result = await runMux(request(root, hanging, { timeoutSec: 0.01 }));

		expect(result).toMatchObject({ ok: false, error: { kind: "timeout" } });
	});

	it("uses the confirmed timeout formula", () => {
		expect(calculateMuxTimeoutSec(0, 21)).toBe(162);
	});
});
