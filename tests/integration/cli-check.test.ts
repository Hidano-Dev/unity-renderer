import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCheck } from "../../src/cli/check.js";

describe("check command integration", () => {
	it("performs preflight against a fake environment without modifying the project", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-check-integration-"));
		try {
			await mkdir(path.join(root, "Assets"), { recursive: true });
			await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
			await writeFile(path.join(root, "Assets", "Main.unity"), "scene\n");
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
			const before = await Promise.all([
				readFile(path.join(root, "Assets", "Main.unity"), "utf8"),
				readFile(
					path.join(root, "ProjectSettings", "ProjectVersion.txt"),
					"utf8",
				),
				readFile(configPath, "utf8"),
			]);

			const result = await runCheck(configPath, {
				detectUnityCli: async () => ({
					ok: true,
					value: { cliVersion: "1.0.0" },
				}),
				readProjectVersion: async () => ({
					ok: true,
					value: { raw: "6000.0.36f1", major: 6000 },
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
					ok: true,
					value: [{ sceneName: "Main", assetPath: "Assets/Main.unity" }],
				}),
			});

			expect(result).toBe(0);
			expect(
				await Promise.all([
					readFile(path.join(root, "Assets", "Main.unity"), "utf8"),
					readFile(
						path.join(root, "ProjectSettings", "ProjectVersion.txt"),
						"utf8",
					),
					readFile(configPath, "utf8"),
				]),
			).toEqual(before);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
