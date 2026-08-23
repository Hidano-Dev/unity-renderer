import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	cleanupOutputFiles,
	expandOutputFileName,
	planOutputs,
	promoteOutputFiles,
	validateOutputFiles,
} from "../../src/batch/output.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "unity-render-output-"));
	temporaryDirectories.push(directory);
	return directory;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("output wildcard expansion", () => {
	it("expands every supported Recorder wildcard", () => {
		const expanded = expandOutputFileName(
			"<Project>_<Scene>_<Recorder>_<Take>_<Resolution>_<Frame Rate>_<Date>_<Time>",
			{
				project: "Demo",
				scene: "Intro",
				recorder: "Movie",
				take: 3,
				resolution: { width: 1920, height: 1080 },
				frameRate: 30,
				date: "20260823",
				time: "142530",
			},
		);

		expect(expanded).toBe("Demo_Intro_Movie_3_1920x1080_30_20260823_142530");
	});

	it("rejects unknown wildcards before output planning", async () => {
		await expect(
			planOutputs({
				directory: await temporaryDirectory(),
				fileName: "render_<Unknown>",
				formats: ["mp4"],
				context: { project: "Demo", scene: "Intro" },
			}),
		).rejects.toThrow(/Unknown output wildcard.*Unknown/);
	});

	it("chooses max existing take plus one without zero padding", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "render_Intro_1.mp4"), "old");
		await writeFile(join(directory, "render_Intro_4.mp4"), "old");

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>_<Take>",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs[0]?.path).toBe(join(directory, "render_Intro_5.mp4"));
	});

	it("scans takes when the configured name already has a video extension", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "render_Intro_2.mp4"), "old");

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>_<Take>.mp4",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs[0]?.path).toBe(join(directory, "render_Intro_3.mp4"));
	});

	it("creates a missing output directory and starts at take 1", async () => {
		const directory = join(await temporaryDirectory(), "renders");

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>_<Take>",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs[0]?.path).toBe(join(directory, "render_Intro_1.mp4"));
		await expect(
			(await import("node:fs/promises")).readdir(directory),
		).resolves.toEqual([]);
	});

	it("numbers every <Take> wildcard consistently", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "2_2.mp4"), "old");

		const outputs = await planOutputs({
			directory,
			fileName: "<Take>_<Take>",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs[0]?.path).toBe(join(directory, "3_3.mp4"));
	});

	it("keeps unknown extensions as part of the name and appends the format extension", async () => {
		const directory = await temporaryDirectory();

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>.avi",
			formats: ["mp4", "mov-prores"],
			context: { project: "Demo", scene: "Intro" },
		});

		// Recorder は拡張子を除去して自動付与するため、計画パスも同じ規則に揃える
		expect(outputs.map(({ path }) => path)).toEqual([
			join(directory, "render_Intro.avi.mp4"),
			join(directory, "render_Intro.avi.mov"),
		]);
	});
});

describe("staging and promotion", () => {
	it("plans a staging path per format and never reuses the final path", async () => {
		const directory = await temporaryDirectory();

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>",
			formats: ["mp4", "mov-prores"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs).toEqual([
			{
				format: "mp4",
				path: join(directory, "render_Intro.mp4"),
				stagingPath: join(directory, "render_Intro.urc-partial.mp4"),
			},
			{
				format: "mov-prores",
				path: join(directory, "render_Intro.mov"),
				stagingPath: join(directory, "render_Intro.urc-partial.mov"),
			},
		]);
	});

	it("promotes staging files over an existing output only on success", async () => {
		const directory = await temporaryDirectory();
		const final = join(directory, "render_Intro.mp4");
		await writeFile(final, "previous good take");
		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});
		await writeFile(outputs[0]?.stagingPath ?? "", "new take");

		// 失敗した録画を模擬: staging を消しても既存の完成動画は残る
		await cleanupOutputFiles(
			outputs.map(({ stagingPath }) => stagingPath),
			false,
		);
		expect(
			await (await import("node:fs/promises")).readFile(final, "utf8"),
		).toBe("previous good take");

		// 成功時のみ置換される
		await writeFile(outputs[0]?.stagingPath ?? "", "new take");
		await promoteOutputFiles(outputs);
		expect(
			await (await import("node:fs/promises")).readFile(final, "utf8"),
		).toBe("new take");
		await expect(
			(await import("node:fs/promises")).stat(outputs[0]?.stagingPath ?? ""),
		).rejects.toThrow();
	});

	it("ignores staging leftovers when choosing the next take", async () => {
		const directory = await temporaryDirectory();
		await writeFile(join(directory, "render_Intro_7.urc-partial.mp4"), "junk");

		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>_<Take>",
			formats: ["mp4"],
			context: { project: "Demo", scene: "Intro" },
		});

		expect(outputs[0]?.path).toBe(join(directory, "render_Intro_1.mp4"));
	});
});

describe("output verification and cleanup", () => {
	it("requires existing non-empty files", async () => {
		const directory = await temporaryDirectory();
		const missing = join(directory, "missing.mp4");
		await expect(validateOutputFiles([missing])).rejects.toThrow(
			/missing or empty/,
		);
		await writeFile(missing, "video");
		await expect(validateOutputFiles([missing])).resolves.toEqual([missing]);
	});

	it("deletes failed outputs except in debug mode", async () => {
		const directory = await temporaryDirectory();
		const output = join(directory, "partial.mp4");
		await writeFile(output, "partial");
		await cleanupOutputFiles([output], false);
		await expect(validateOutputFiles([output])).rejects.toThrow();

		await writeFile(output, "partial");
		await cleanupOutputFiles([output], true);
		await expect(validateOutputFiles([output])).resolves.toEqual([output]);
	});
});
