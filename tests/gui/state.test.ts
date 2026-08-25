import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	defaultGuiState,
	GUI_STATE_FILE_NAME,
	type GuiState,
	loadGuiState,
	resolveGuiStatePath,
	sanitizeGuiState,
	saveGuiState,
} from "../../src/gui/state.js";

const temporaryDirectories: string[] = [];

async function temporaryStatePath(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-gui-state-"));
	temporaryDirectories.push(root);
	return path.join(root, "nested", GUI_STATE_FILE_NAME);
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("sanitizeGuiState", () => {
	it("falls back to defaults for a non-object", () => {
		expect(sanitizeGuiState(null)).toEqual(defaultGuiState);
		expect(sanitizeGuiState("nope")).toEqual(defaultGuiState);
	});

	it("keeps known fields and fills in missing ones", () => {
		const state = sanitizeGuiState({
			projectPath: "D:\\proj",
			selectedScenes: ["Main"],
		});

		expect(state.projectPath).toBe("D:\\proj");
		expect(state.selectedScenes).toEqual(["Main"]);
		expect(state.resolution).toEqual(defaultGuiState.resolution);
		expect(state.frameRate).toBe(defaultGuiState.frameRate);
	});

	it("remembers the scene filter and ignores a non-string value", () => {
		expect(sanitizeGuiState({ sceneFilter: "cut" }).sceneFilter).toBe("cut");
		expect(sanitizeGuiState({ sceneFilter: 42 }).sceneFilter).toBe("");
	});

	it("keeps the selection independent from the scene filter", () => {
		// 絞り込みは表示だけの状態。保存された選択を絞り込みが削ってはいけない
		const state = sanitizeGuiState({
			sceneFilter: "cut",
			selectedScenes: ["Main", "Title"],
		});

		expect(state.selectedScenes).toEqual(["Main", "Title"]);
	});

	it("drops non-string and duplicate scene names", () => {
		const state = sanitizeGuiState({
			selectedScenes: ["Main", "Main", "", 42, null, "Title"],
		});

		expect(state.selectedScenes).toEqual(["Main", "Title"]);
	});

	it("keeps only known formats and never leaves the list empty", () => {
		expect(
			sanitizeGuiState({ formats: ["mov-prores", "avi"] }).formats,
		).toEqual(["mov-prores"]);
		expect(sanitizeGuiState({ formats: ["avi"] }).formats).toEqual(["mp4"]);
		expect(sanitizeGuiState({ formats: [] }).formats).toEqual(["mp4"]);
	});

	it("rejects non-positive and non-finite numbers", () => {
		const state = sanitizeGuiState({
			frameRate: 0,
			resolution: { width: Number.NaN, height: -1 },
		});

		expect(state.frameRate).toBe(defaultGuiState.frameRate);
		expect(state.resolution).toEqual(defaultGuiState.resolution);
	});
});

describe("resolveGuiStatePath", () => {
	it("places the file under the tool directory in LOCALAPPDATA", () => {
		const resolved = resolveGuiStatePath({
			env: { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" },
		});

		expect(resolved).toEqual({
			ok: true,
			value: `C:\\Users\\x\\AppData\\Local\\unity-render-core\\${GUI_STATE_FILE_NAME}`,
		});
	});

	it("reports the missing environment variable instead of guessing a path", () => {
		const resolved = resolveGuiStatePath({ env: {} });

		expect(resolved.ok).toBe(false);
	});
});

describe("loadGuiState / saveGuiState", () => {
	it("round-trips the selection and creates missing directories", async () => {
		const stateFilePath = await temporaryStatePath();
		const state: GuiState = {
			...defaultGuiState,
			projectPath: "D:\\proj",
			outputDirectory: "D:\\out",
			selectedScenes: ["Main", "Title"],
			formats: ["mp4", "mov-prores"],
		};

		const saved = await saveGuiState(state, { stateFilePath });
		expect(saved.ok).toBe(true);

		expect(await loadGuiState({ stateFilePath })).toEqual(state);
	});

	it("returns defaults when the file is missing", async () => {
		const stateFilePath = await temporaryStatePath();

		expect(await loadGuiState({ stateFilePath })).toEqual(defaultGuiState);
	});

	it("returns defaults when the file is corrupt rather than throwing", async () => {
		const stateFilePath = await temporaryStatePath();
		await saveGuiState(defaultGuiState, { stateFilePath });
		await writeFile(stateFilePath, "{ not json", "utf8");

		expect(await loadGuiState({ stateFilePath })).toEqual(defaultGuiState);
	});

	it("tolerates a UTF-8 BOM written by Windows editors", async () => {
		const stateFilePath = await temporaryStatePath();
		await saveGuiState(defaultGuiState, { stateFilePath });
		await writeFile(
			stateFilePath,
			`\uFEFF${JSON.stringify({ ...defaultGuiState, projectPath: "D:\\bom" })}`,
			"utf8",
		);

		expect((await loadGuiState({ stateFilePath })).projectPath).toBe("D:\\bom");
	});

	it("writes sanitized content so a corrupt in-memory state cannot be persisted", async () => {
		const stateFilePath = await temporaryStatePath();

		await saveGuiState(
			{ ...defaultGuiState, frameRate: Number.NaN } as GuiState,
			{ stateFilePath },
		);

		const written = JSON.parse(await readFile(stateFilePath, "utf8")) as {
			frameRate: number;
		};
		expect(written.frameRate).toBe(defaultGuiState.frameRate);
	});
});
