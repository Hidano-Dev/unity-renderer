import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
	type RenderCommandDependencies,
	runRender,
} from "../../src/cli/render.js";

const projectFiles = async (root: string) => {
	await mkdir(path.join(root, "Assets"), { recursive: true });
	await mkdir(path.join(root, "Packages"), { recursive: true });
	await mkdir(path.join(root, "ProjectSettings"), { recursive: true });
	await writeFile(path.join(root, "Assets", "Main.unity"), "scene");
	await writeFile(
		path.join(root, "Packages", "manifest.json"),
		JSON.stringify({ dependencies: {} }),
	);
	await writeFile(
		path.join(root, "ProjectSettings", "ProjectVersion.txt"),
		"m_EditorVersion: 6000.0.36f1\n",
	);
};

describe("render command", () => {
	it("runs preflight, one batch, and restores the project", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-render-cli-"));
		try {
			await projectFiles(root);
			const configPath = path.join(root, "render-config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					projectPath: root,
					scenes: ["Main"],
					resolution: { width: 1920, height: 1080 },
					frameRate: 30,
					formats: ["mp4"],
					output: {
						directory: path.join(root, "renders"),
						fileName: "<Scene>",
					},
				}),
			);
			const calls: string[] = [];
			const dependencies: RenderCommandDependencies = {
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
				beginSession: async () => {
					calls.push("begin");
					return {
						ok: true,
						value: {
							version: 1,
							projectPath: root,
							createdAt: "now",
							status: "active",
							sessionDirectory: root,
							files: [],
							addedPackages: [],
						},
					};
				},
				batchRunner: {
					run: async (plan) => {
						calls.push(`run:${plan.scenes[0]?.sceneName}`);
						return {
							scenes: [
								{
									sceneName: "Main",
									outcome: "success",
									warnings: [],
									outputs: [],
									durationSec: 0,
								},
							],
							restoreSucceeded: true,
						};
					},
				},
			};
			expect(await runRender(configPath, dependencies)).toBe(0);
			expect(calls).toEqual(["cli", "editors", "begin", "run:Main"]);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("fails before starting a session when the editor version does not match", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-render-cli-"));
		try {
			await projectFiles(root);
			const configPath = path.join(root, "render-config.json");
			await writeFile(
				configPath,
				JSON.stringify({
					projectPath: root,
					scenes: ["Main"],
					resolution: { width: 1, height: 1 },
					frameRate: 1,
					formats: ["mp4"],
					output: { directory: root, fileName: "x" },
				}),
			);
			let started = false;
			const dependencies: RenderCommandDependencies = {
				listEditors: async () => ({
					ok: true,
					value: [
						{
							version: { raw: "6000.0.35f1", major: 6000 },
							executablePath: "Unity.exe",
						},
					],
				}),
				beginSession: async () => {
					started = true;
					throw new Error("must not run");
				},
			};
			expect(await runRender(configPath, dependencies)).toBe(1);
			expect(started).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
