import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	DEFAULT_EDITOR_QUIT_TIMEOUT_SEC,
	DEFAULT_EDITOR_START_TIMEOUT_SEC,
	loadConfig,
	resolveRecordingTimeoutSec,
} from "../../src/config/load.js";

const validConfig = {
	projectPath: "C:\\work\\unity-project",
	scenes: ["Main"],
	resolution: { width: 1920, height: 1080 },
	frameRate: 60,
	formats: ["mp4"] as ("mp4" | "mov-prores")[],
	output: { directory: "C:\\renders", fileName: "<Scene>" },
};

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function writeConfig(value: unknown): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "unity-render-core-config-"));
	temporaryDirectories.push(directory);
	const filePath = join(directory, "render-config.json");
	await writeFile(filePath, JSON.stringify(value), "utf8");
	return filePath;
}

describe("loadConfig", () => {
	it("reads JSON and applies stable defaults", async () => {
		const result = await loadConfig(await writeConfig(validConfig));

		expect(result).toMatchObject({
			ok: true,
			value: {
				debug: false,
				timeouts: {
					editorStartSec: DEFAULT_EDITOR_START_TIMEOUT_SEC,
					editorQuitSec: DEFAULT_EDITOR_QUIT_TIMEOUT_SEC,
				},
			},
		});
	});

	it("returns useful errors for missing and malformed files", async () => {
		const missing = await loadConfig(
			join(tmpdir(), "does-not-exist-render-config.json"),
		);
		expect(missing).toMatchObject({ ok: false, error: { kind: "not-found" } });

		const malformedPath = await writeConfig(validConfig);
		await writeFile(malformedPath, "{", "utf8");
		const malformed = await loadConfig(malformedPath);
		expect(malformed).toMatchObject({
			ok: false,
			error: { kind: "parse-error" },
		});
	});

	it("reports schema errors before any runtime work", async () => {
		const result = await loadConfig(
			await writeConfig({ ...validConfig, frameRate: 0 }),
		);

		expect(result).toMatchObject({
			ok: false,
			error: { kind: "validation-error" },
		});
		if (!result.ok)
			expect(result.error.issues).toContainEqual({
				path: "frameRate",
				message: expect.any(String),
			});
	});
});

describe("resolveRecordingTimeoutSec", () => {
	it("uses an explicit override when supplied", () => {
		expect(
			resolveRecordingTimeoutSec(
				{ ...validConfig, timeouts: { recordingSec: 42 } },
				10,
			),
		).toBe(42);
	});

	it("calculates the dynamic default with a ceiling", () => {
		expect(resolveRecordingTimeoutSec(validConfig, 12.1)).toBe(217);
	});
});
