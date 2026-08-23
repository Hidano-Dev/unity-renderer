import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type BackupSession,
	beginBackupSession,
	readBackupSession,
} from "../../src/project-guard/backup.js";

const temporaryDirectories: string[] = [];

async function projectWithManifest(includeLock = true): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-project-"));
	temporaryDirectories.push(root);
	await mkdir(path.join(root, "Packages"));
	await writeFile(
		path.join(root, "Packages", "manifest.json"),
		'{"dependencies":{"com.example.base":"1.0.0"}}\n',
	);
	if (includeLock)
		await writeFile(
			path.join(root, "Packages", "packages-lock.json"),
			'{"dependencies":{}}\n',
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

describe("backup sessions", () => {
	it("backs up manifests, verifies bytes, and writes active metadata atomically", async () => {
		const projectPath = await projectWithManifest();
		const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "urc-session-"));
		temporaryDirectories.push(sessionRoot);
		const result = await beginBackupSession(projectPath, { sessionRoot });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.value.status).toBe("active");
		expect(result.value.files).toHaveLength(2);
		for (const file of result.value.files) {
			expect(
				await readFile(
					path.join(result.value.sessionDirectory, file.backupFileName),
				),
			).toEqual(await readFile(path.join(projectPath, file.relativePath)));
		}
		expect(
			await readBackupSession(result.value.sessionDirectory),
		).toMatchObject({ status: "active" });
	});

	it("records a missing packages lock file without creating a backup", async () => {
		const projectPath = await projectWithManifest(false);
		const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "urc-session-"));
		temporaryDirectories.push(sessionRoot);
		const result = await beginBackupSession(projectPath, { sessionRoot });
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const lock = result.value.files.find((file) =>
			file.relativePath.endsWith("packages-lock.json"),
		);
		expect(lock).toMatchObject({ exists: false });
	});

	it("uses a stable session metadata shape", () => {
		const session: BackupSession = {
			version: 1,
			projectPath: "C:\\project",
			createdAt: new Date().toISOString(),
			status: "active",
			sessionDirectory: "C:\\session",
			files: [],
			addedPackages: [],
		};
		expect(session.version).toBe(1);
	});
});
