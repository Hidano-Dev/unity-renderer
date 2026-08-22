import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginBackupSession } from "../../src/project-guard/backup.js";
import { patchManifest } from "../../src/project-guard/manifest-patch.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-project-"));
	temporaryDirectories.push(root);
	await mkdir(path.join(root, "Packages"));
	await writeFile(
		path.join(root, "Packages", "manifest.json"),
		'{\n  "dependencies": {\n    "com.example.base": "1.0.0"\n  }\n}\n',
	);
	return root;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("manifest patch", () => {
	it("does not patch before a verified backup and then adds pinned packages", async () => {
		const projectPath = await project();
		const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "urc-session-"));
		temporaryDirectories.push(sessionRoot);
		const before = await readFile(
			path.join(projectPath, "Packages", "manifest.json"),
			"utf8",
		);
		const backup = await beginBackupSession(projectPath, { sessionRoot });
		expect(backup.ok).toBe(true);
		if (!backup.ok) return;
		const result = await patchManifest(projectPath);
		expect(result.ok).toBe(true);
		const manifest = JSON.parse(
			await readFile(
				path.join(projectPath, "Packages", "manifest.json"),
				"utf8",
			),
		) as { dependencies: Record<string, string> };
		expect(manifest.dependencies).toMatchObject({
			"com.unity.recorder": "5.1.0",
			"com.unity.pipeline": "0.5.0-exp.1",
		});
		expect(before).not.toBe(
			await readFile(
				path.join(projectPath, "Packages", "manifest.json"),
				"utf8",
			),
		);
	});

	it("does not replace an existing recorder version", async () => {
		const projectPath = await project();
		await writeFile(
			path.join(projectPath, "Packages", "manifest.json"),
			'{"dependencies":{"com.unity.recorder":"4.0.0"}}\n',
		);
		const result = await patchManifest(projectPath);
		expect(result.ok).toBe(true);
		if (result.ok)
			expect(result.value).toEqual([
				{ name: "com.unity.pipeline", version: "0.5.0-exp.1" },
			]);
	});
});
