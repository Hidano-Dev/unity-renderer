import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveScenes } from "../../src/project-guard/scene-resolver.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-scenes-project-"));
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

describe("scene resolver", () => {
	it("resolves Scene names recursively to Assets-relative paths", async () => {
		const projectPath = await project();
		await scene(projectPath, path.join("Scenes", "Main.unity"));

		const result = await resolveScenes(projectPath, ["Main"]);

		expect(result).toEqual({
			ok: true,
			value: [{ sceneName: "Main", assetPath: "Assets/Scenes/Main.unity" }],
		});
	});

	it("reports all missing names in one result", async () => {
		const projectPath = await project();
		await scene(projectPath, "Existing.unity");

		const result = await resolveScenes(projectPath, ["MissingA", "MissingB"]);

		expect(result).toEqual({
			ok: false,
			error: {
				kind: "scenes-missing",
				details: [
					{ sceneName: "MissingA", candidatePaths: [] },
					{ sceneName: "MissingB", candidatePaths: [] },
				],
			},
		});
	});

	it("reports duplicate names and every candidate path", async () => {
		const projectPath = await project();
		await scene(projectPath, path.join("A", "Shared.unity"));
		await scene(projectPath, path.join("B", "Shared.unity"));

		const result = await resolveScenes(projectPath, ["Shared"]);

		expect(result).toEqual({
			ok: false,
			error: {
				kind: "scenes-ambiguous",
				details: [
					{
						sceneName: "Shared",
						candidatePaths: ["Assets/A/Shared.unity", "Assets/B/Shared.unity"],
					},
				],
			},
		});
	});

	it("matches case-sensitively and excludes Packages", async () => {
		const projectPath = await project();
		await scene(projectPath, "Main.unity");
		await scene(projectPath, "main.unity");
		const packageScene = path.join(projectPath, "Packages", "Main.unity");
		await mkdir(path.dirname(packageScene), { recursive: true });
		await writeFile(packageScene, "scene");

		const result = await resolveScenes(projectPath, ["Main"]);

		expect(result).toEqual({
			ok: true,
			value: [{ sceneName: "Main", assetPath: "Assets/Main.unity" }],
		});
	});
});
