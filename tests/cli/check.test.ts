import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type CheckCommandDependencies,
	runCheck,
} from "../../src/cli/check.js";

describe("check command", () => {
	it("validates preflight without starting an Editor or changing the project", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-check-"));
		try {
			await mkdir(path.join(root, "Assets"), { recursive: true });
			await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
			await writeFile(path.join(root, "Assets", "Main.unity"), "scene");
			await writeFile(
				path.join(root, "ProjectSettings", "ProjectVersion.txt"),
				"m_EditorVersion: 6000.0.36f1\n",
			);
			const configPath = path.join(root, "config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					projectPath: root,
					scenes: ["Main"],
					resolution: { width: 1920, height: 1080 },
					frameRate: 30,
					formats: ["mp4"],
					output: { directory: root, fileName: "render" },
				}),
			);
			const calls: string[] = [];
			const dependencies: CheckCommandDependencies = {
				detectUnityCli: async () => {
					calls.push("cli");
					return { ok: true, value: { cliVersion: "1.0.0" } };
				},
				listEditors: async () => {
					calls.push("editors");
					return {
						ok: true,
						value: [
							{
								version: { raw: "6000.0.36f1", major: 6000 },
								executablePath: "Unity.exe",
							},
						],
					};
				},
				resolveScenes: async () => {
					calls.push("scenes");
					return {
						ok: true,
						value: [{ sceneName: "Main", assetPath: "Assets/Main.unity" }],
					};
				},
			};

			expect(await runCheck(configPath, dependencies)).toBe(0);
			expect(calls).toEqual(["cli", "editors", "scenes"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("reports missing scenes and does not continue to Editor checks", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-check-"));
		await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
		await writeFile(
			path.join(root, "ProjectSettings", "ProjectVersion.txt"),
			"m_EditorVersion: 6000.0.36f1\n",
		);
		const configPath = path.join(root, "config.json");
		await writeFile(
			configPath,
			JSON.stringify({
				projectPath: root,
				scenes: ["Missing"],
				resolution: { width: 1, height: 1 },
				frameRate: 1,
				formats: ["mp4"],
				output: { directory: root, fileName: "render" },
			}),
		);
		const write: string[] = [];
		const dependencies: CheckCommandDependencies = {
			detectUnityCli: async () => ({
				ok: true,
				value: { cliVersion: "1.0.0" },
			}),
			listEditors: async () => ({
				ok: true,
				value: [
					{
						version: { raw: "6000.0.36f1", major: 6000 },
						executablePath: "Unity.exe",
					},
				],
			}),
			resolveScenes: async () => ({
				ok: false,
				error: {
					kind: "scenes-missing",
					details: [{ sceneName: "Missing", candidatePaths: [] }],
				},
			}),
			write: (message) => write.push(message),
		};
		expect(await runCheck(configPath, dependencies)).toBe(1);
		expect(write.join("\n")).toContain("Missing");
		await rm(root, { recursive: true, force: true });
	});
});
