import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	audioMetadataFileName,
	loadAudioTimelineMetadata,
} from "../../../src/audio-remux/metadata/load.js";

// バッチは全 Scene に同じセッションディレクトリを渡すため、固定名だと次の Scene の
// 抽出が前の Scene のメタデータを File.Replace で上書きし、デバッグ時に保持される
// はずの調査用 JSON が最後の Scene 分しか残らない（11.3）。
describe("audioMetadataFileName", () => {
	it("namespaces the file per scene", () => {
		expect(audioMetadataFileName("Intro")).toBe(
			"timeline-audio-metadata.Intro.json",
		);
		expect(audioMetadataFileName("Intro")).not.toBe(
			audioMetadataFileName("Outro"),
		);
	});

	it("strips characters that are not usable in a Windows file name", () => {
		const name = audioMetadataFileName('Scenes/Sub\\A:B*?"<>| ');
		// Scene 名はユーザー入力なので、パス区切りや予約文字が残ると
		// セッションディレクトリの外へ書き出しうる。
		expect(name).not.toMatch(/[<>:"/\\|?*]/);
		expect(name.startsWith("timeline-audio-metadata.")).toBe(true);
		expect(name.endsWith(".json")).toBe(true);
	});

	it("keeps the name bounded for very long scene names", () => {
		const name = audioMetadataFileName("S".repeat(500));
		expect(name.length).toBeLessThanOrEqual(120);
	});

	it("falls back to the default name when nothing usable remains", () => {
		expect(audioMetadataFileName("")).toBe("timeline-audio-metadata.json");
	});
});

const directories: string[] = [];
afterEach(async () => {
	await Promise.all(
		directories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

const metadata = {
	schemaVersion: 1,
	sceneName: "Main",
	extractedAt: "2026-08-23T00:00:00.000Z",
	clips: [
		{
			id: "Root/Track[0]",
			trackPath: "Root/Track",
			sourcePath: "SOURCE_PATH",
			sourceDurationSec: 1,
			rootStartSec: 0,
			rootEndSec: 1,
			clipInSec: 0,
			effectiveSpeed: 1,
			clipVolume: 1,
			trackVolume: 1,
			trackMuted: false,
			loop: false,
		},
	],
	errors: [],
	warnings: [],
};

async function fixtureDirectory(): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "timeline-audio-metadata-"));
	directories.push(directory);
	return directory;
}

describe("loadAudioTimelineMetadata", () => {
	it("parses, validates, and confirms every source file", async () => {
		const directory = await fixtureDirectory();
		const sourcePath = join(directory, "tone.wav");
		await writeFile(sourcePath, "fixture");
		await writeFile(
			join(directory, "timeline-audio-metadata.json"),
			JSON.stringify({
				...metadata,
				clips: [{ ...metadata.clips[0], sourcePath }],
			}),
		);

		const result = await loadAudioTimelineMetadata(directory);
		expect(result).toMatchObject({ ok: true, value: { sceneName: "Main" } });
	});

	it("reports parse and schema errors without starting processing", async () => {
		const directory = await fixtureDirectory();
		await writeFile(join(directory, "timeline-audio-metadata.json"), "{broken");
		const result = await loadAudioTimelineMetadata(directory);
		expect(result).toMatchObject({ ok: false, error: { kind: "parse-error" } });

		await writeFile(
			join(directory, "timeline-audio-metadata.json"),
			JSON.stringify({ ...metadata, schemaVersion: 99 }),
		);
		const schemaResult = await loadAudioTimelineMetadata(directory);
		expect(schemaResult).toMatchObject({
			ok: false,
			error: { kind: "validation-error" },
		});
	});

	it("rejects non-empty extraction errors and lists all missing sources", async () => {
		const directory = await fixtureDirectory();
		await writeFile(
			join(directory, "timeline-audio-metadata.json"),
			JSON.stringify({
				...metadata,
				clips: [
					{
						...metadata.clips[0],
						id: "missing-a",
						sourcePath: join(directory, "a.wav"),
					},
					{
						...metadata.clips[0],
						id: "missing-b",
						sourcePath: join(directory, "b.wav"),
					},
				],
				errors: [
					{ kind: "unexpected", clipId: "missing-a", detail: "extract failed" },
				],
			}),
		);

		const result = await loadAudioTimelineMetadata(directory);
		expect(result).toMatchObject({
			ok: false,
			error: { kind: "extraction-errors" },
		});
		// Each extraction error is carried through individually with its clip id
		// and detail; a single generic issue would leave the operator unable to
		// tell which clip or source file failed (10.1).
		if (!result.ok) {
			expect(result.error.issues.map((issue) => issue.path)).toEqual([
				"errors[0]",
			]);
			expect(result.error.issues[0]?.message).toContain("missing-a");
			expect(result.error.issues[0]?.message).toContain("extract failed");
		}

		await writeFile(
			join(directory, "timeline-audio-metadata.json"),
			JSON.stringify({
				...metadata,
				clips: [
					{
						...metadata.clips[0],
						id: "missing-a",
						sourcePath: join(directory, "a.wav"),
					},
					{
						...metadata.clips[0],
						id: "missing-b",
						sourcePath: join(directory, "b.wav"),
					},
				],
			}),
		);
		const missingResult = await loadAudioTimelineMetadata(directory);
		expect(missingResult).toMatchObject({
			ok: false,
			error: { kind: "source-missing" },
		});
		if (!missingResult.ok)
			expect(missingResult.error.issues.map((issue) => issue.path)).toEqual([
				"clips[0].sourcePath",
				"clips[1].sourcePath",
			]);
	});
});
