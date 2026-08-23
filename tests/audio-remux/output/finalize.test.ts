import {
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { finalizeOutput } from "../../../src/audio-remux/output/finalize.js";

const directories: string[] = [];

async function tempDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "timeline-audio-finalize-"));
	directories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("finalizeOutput", () => {
	it("does not replace the silent video when the muxed file is invalid", async () => {
		const directory = await tempDirectory();
		const videoPath = join(directory, "render.mp4");
		const muxedPath = join(directory, "render.mp4.audiotmp");
		await writeFile(videoPath, "silent");
		await writeFile(muxedPath, "");

		const result = await finalizeOutput(videoPath, muxedPath, false);

		expect(result).toEqual({
			ok: false,
			error: {
				kind: "verify-failed",
				message: expect.stringContaining("empty"),
			},
		});
		expect(await readFile(videoPath, "utf8")).toBe("silent");
		expect(await stat(muxedPath)).toBeTruthy();
	});

	it("promotes the muxed file and keeps a debug backup of the silent video", async () => {
		const directory = await tempDirectory();
		const videoPath = join(directory, "render.mp4");
		const muxedPath = join(directory, "render.mp4.audiotmp");
		await writeFile(videoPath, "silent");
		await writeFile(muxedPath, "with audio");

		const result = await finalizeOutput(videoPath, muxedPath, true);

		expect(result).toEqual({
			ok: true,
			value: {
				finalPath: videoPath,
				silentBackupPath: join(directory, "render.noaudio.mp4"),
			},
		});
		expect(await readFile(videoPath, "utf8")).toBe("with audio");
		expect(await readFile(join(directory, "render.noaudio.mp4"), "utf8")).toBe(
			"silent",
		);
		expect((await readdir(directory)).sort()).toEqual([
			"render.mp4",
			"render.noaudio.mp4",
		]);
	});

	it("promotes without retaining the silent source in normal mode", async () => {
		const directory = await tempDirectory();
		const videoPath = join(directory, "render.mov");
		const muxedPath = join(directory, "render.mov.audiotmp");
		await writeFile(videoPath, "silent");
		await writeFile(muxedPath, "with audio");

		const result = await finalizeOutput(videoPath, muxedPath, false);

		expect(result).toEqual({ ok: true, value: { finalPath: videoPath } });
		expect(await readFile(videoPath, "utf8")).toBe("with audio");
		expect((await readdir(directory)).sort()).toEqual(["render.mov"]);
	});
});
