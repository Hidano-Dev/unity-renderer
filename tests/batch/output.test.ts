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

	it("rolls the whole set back when one format fails to publish", async () => {
		const { readFile, readdir } = await import("node:fs/promises");
		const directory = await temporaryDirectory();
		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>",
			formats: ["mp4", "mov-prores"],
			context: { project: "Demo", scene: "Intro" },
		});
		// 両フォーマットに前回の正常な動画がある状態
		for (const output of outputs) {
			await writeFile(output.path, `previous ${output.format}`);
			await writeFile(output.stagingPath, `new ${output.format}`);
		}
		// 2 件目の staging を失わせ、公開の途中で失敗させる
		await (await import("node:fs/promises")).rm(outputs[1]?.stagingPath ?? "");

		await expect(promoteOutputFiles(outputs)).rejects.toThrow();

		// 1 件目は元の動画に戻り、staging も残っている(部分公開で世代が混ざらない)
		expect(await readFile(outputs[0]?.path ?? "", "utf8")).toBe("previous mp4");
		expect(await readFile(outputs[0]?.stagingPath ?? "", "utf8")).toBe(
			"new mp4",
		);
		// 2 件目の既存動画も失われない
		expect(await readFile(outputs[1]?.path ?? "", "utf8")).toBe(
			"previous mov-prores",
		);
		// 退避用の一時ファイルを残さない
		expect(
			(await readdir(directory)).filter((name) => name.includes(".previous")),
		).toEqual([]);
	});

	it("journals displaced outputs so a crash mid-promotion stays recoverable", async () => {
		const { readFile, stat } = await import("node:fs/promises");
		const { rollbackPromotionJournal } = await import(
			"../../src/shared/promotion-journal.js"
		);
		const directory = await temporaryDirectory();
		const journalPath = join(directory, "promote-Intro.json");
		const outputs = await planOutputs({
			directory,
			fileName: "render_<Scene>",
			formats: ["mp4", "mov-prores"],
			context: { project: "Demo", scene: "Intro" },
		});
		for (const output of outputs) {
			await writeFile(output.path, `previous ${output.format}`);
			await writeFile(output.stagingPath, `new ${output.format}`);
		}
		// 2 件目の staging を失わせ、公開の途中で中断させる
		await (await import("node:fs/promises")).rm(outputs[1]?.stagingPath ?? "");
		await expect(
			promoteOutputFiles(outputs, { journalPath }),
		).rejects.toThrow();

		// 例外経路では巻き戻し済みなのでジャーナルは残らない
		await expect(stat(journalPath)).rejects.toThrow();

		// クラッシュを模擬: 退避だけ済んだ状態のジャーナルから復旧できる
		const displacedBackup = join(directory, "orphan.previous");
		await writeFile(displacedBackup, "previous mp4");
		await (await import("node:fs/promises")).rm(outputs[0]?.path ?? "");
		await writeFile(
			journalPath,
			JSON.stringify({
				displaced: [{ path: outputs[0]?.path, backup: displacedBackup }],
			}),
		);

		expect(await rollbackPromotionJournal(journalPath)).toEqual([]);
		expect(await readFile(outputs[0]?.path ?? "", "utf8")).toBe("previous mp4");
		await expect(stat(journalPath)).rejects.toThrow();
	});

	it("journals the displacement plan before renaming, including entries never executed", async () => {
		const { readFile, stat } = await import("node:fs/promises");
		const directory = await temporaryDirectory();
		const journalPath = join(directory, "promote-Intro.json");
		const shared = join(directory, "render_Intro.mp4");
		// 1 件目は既存出力が無く退避 rename が実行されない。2 件目で公開に失敗し、
		// 巻き戻しも完了しないためジャーナルが保全される
		const outputs = [
			{
				format: "mp4" as const,
				path: shared,
				stagingPath: join(directory, "a.urc-partial.mp4"),
			},
			{
				format: "mov-prores" as const,
				path: shared,
				stagingPath: join(directory, "missing.urc-partial.mov"),
			},
		];
		await writeFile(outputs[0]?.stagingPath ?? "", "new");

		await expect(promoteOutputFiles(outputs, { journalPath })).rejects.toThrow(
			/手動復旧/,
		);

		const journal = JSON.parse(await readFile(journalPath, "utf8")) as {
			displaced: { path: string; backup: string }[];
		};
		// rename より先に記録するため、実行されなかった退避も予定として残る
		expect(journal.displaced).toHaveLength(2);
		await expect(stat(journal.displaced[0]?.backup ?? "")).rejects.toThrow();
	});

	it("reports unresolved files when the rollback itself fails", async () => {
		const directory = await temporaryDirectory();
		const shared = join(directory, "render_Intro.mp4");
		// 1 件目の公開後に同じ最終パスが 2 件目の退避で持ち去られ、巻き戻しの
		// rename が対象を見失う状況(補償処理自体の失敗)
		const outputs = [
			{
				format: "mp4" as const,
				path: shared,
				stagingPath: join(directory, "render_Intro.urc-partial.mp4"),
			},
			{
				format: "mov-prores" as const,
				path: shared,
				stagingPath: join(directory, "missing.urc-partial.mov"),
			},
		];
		await writeFile(shared, "previous");
		await writeFile(outputs[0]?.stagingPath ?? "", "new");

		await expect(promoteOutputFiles(outputs)).rejects.toThrow(/手動復旧/);
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
