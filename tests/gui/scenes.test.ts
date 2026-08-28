import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	groupSceneFiles,
	listGuiScenes,
	selectableSelection,
} from "../../src/gui/scenes.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-gui-scenes-"));
	temporaryDirectories.push(root);
	await mkdir(path.join(root, "Assets"), { recursive: true });
	return root;
}

async function scene(projectPath: string, relativePath: string): Promise<void> {
	const filePath = path.join(projectPath, "Assets", relativePath);
	await mkdir(path.dirname(filePath), { recursive: true });
	await writeFile(filePath, "scene");
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("groupSceneFiles", () => {
	it("marks a uniquely named Scene as selectable", () => {
		const entries = groupSceneFiles([
			{ sceneName: "Main", assetPath: "Assets/Scenes/Main.unity" },
		]);

		expect(entries).toEqual([
			{
				sceneName: "Main",
				assetPaths: ["Assets/Scenes/Main.unity"],
				selectable: true,
			},
		]);
	});

	it("marks duplicated names as not selectable and keeps every candidate path", () => {
		const entries = groupSceneFiles([
			{ sceneName: "Shared", assetPath: "Assets/B/Shared.unity" },
			{ sceneName: "Shared", assetPath: "Assets/A/Shared.unity" },
		]);

		expect(entries).toEqual([
			{
				sceneName: "Shared",
				assetPaths: ["Assets/A/Shared.unity", "Assets/B/Shared.unity"],
				selectable: false,
			},
		]);
	});

	it("sorts entries by Scene name", () => {
		const entries = groupSceneFiles([
			{ sceneName: "Title", assetPath: "Assets/Title.unity" },
			{ sceneName: "Boot", assetPath: "Assets/Boot.unity" },
		]);

		expect(entries.map((entry) => entry.sceneName)).toEqual(["Boot", "Title"]);
	});
});

describe("listGuiScenes", () => {
	it("lists every .unity file under Assets", async () => {
		const projectPath = await project();
		await scene(projectPath, path.join("Scenes", "Main.unity"));
		await scene(projectPath, "Title.unity");

		const entries = await listGuiScenes(projectPath);

		expect(entries).toEqual([
			{
				sceneName: "Main",
				assetPaths: ["Assets/Scenes/Main.unity"],
				selectable: true,
			},
			{
				sceneName: "Title",
				assetPaths: ["Assets/Title.unity"],
				selectable: true,
			},
		]);
	});

	it("returns an empty list when Assets does not exist", async () => {
		const root = await mkdtemp(path.join(os.tmpdir(), "urc-gui-empty-"));
		temporaryDirectories.push(root);

		expect(await listGuiScenes(root)).toEqual([]);
	});
});

describe("selectableSelection", () => {
	it("keeps only selectable entries that are still present", () => {
		const entries = groupSceneFiles([
			{ sceneName: "Main", assetPath: "Assets/Main.unity" },
			{ sceneName: "Shared", assetPath: "Assets/A/Shared.unity" },
			{ sceneName: "Shared", assetPath: "Assets/B/Shared.unity" },
		]);

		expect(selectableSelection(entries, ["Main", "Shared", "Deleted"])).toEqual(
			["Main"],
		);
	});
});
