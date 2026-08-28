import {
	mkdir,
	mkdtemp,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
	type BackupSession,
	beginBackupSession,
	readBackupSession,
	registerBackupFiles,
	restoreBackupSession,
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
		const legacy: BackupSession = {
			version: 1,
			projectPath: "C:\\project",
			createdAt: new Date().toISOString(),
			status: "active",
			sessionDirectory: "C:\\session",
			files: [],
			addedPackages: [],
		};
		expect(legacy.version).toBe(1);
	});
});

describe("registerBackupFiles", () => {
	async function startSession(): Promise<{
		projectPath: string;
		session: BackupSession;
	}> {
		const projectPath = await projectWithManifest();
		const sessionRoot = await mkdtemp(path.join(os.tmpdir(), "urc-session-"));
		temporaryDirectories.push(sessionRoot);
		await mkdir(path.join(projectPath, "Assets", "Timelines"), {
			recursive: true,
		});
		await writeFile(
			path.join(projectPath, "Assets", "Timelines", "Intro.playable"),
			"original timeline\n",
		);
		const started = await beginBackupSession(projectPath, { sessionRoot });
		if (!started.ok) throw new Error("session setup failed");
		return { projectPath, session: started.value };
	}

	it("copies the asset, records it, and persists the updated session", async () => {
		const { projectPath, session } = await startSession();

		const result = await registerBackupFiles(session, [
			"Assets/Timelines/Intro.playable",
		]);

		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const added = result.value.files.find((file) =>
			file.relativePath.endsWith("Intro.playable"),
		);
		expect(added).toMatchObject({ exists: true, skipIfUnchanged: true });
		expect(
			await readFile(
				path.join(session.sessionDirectory, added?.backupFileName ?? ""),
				"utf8",
			),
		).toBe("original timeline\n");
		// クラッシュ後の recoverProject が同じ一覧を読めるよう、ディスクにも書く
		expect(
			(await readBackupSession(session.sessionDirectory)).files,
		).toHaveLength(result.value.files.length);
		expect(projectPath).toBeTruthy();
	});

	it("keeps the first backup when the same asset is registered twice", async () => {
		const { projectPath, session } = await startSession();
		const first = await registerBackupFiles(session, [
			"Assets/Timelines/Intro.playable",
		]);
		if (!first.ok) return;
		await writeFile(
			path.join(projectPath, "Assets", "Timelines", "Intro.playable"),
			"modified\n",
		);

		const second = await registerBackupFiles(first.value, [
			"Assets/Timelines/Intro.playable",
		]);

		expect(second.ok).toBe(true);
		if (!second.ok) return;
		expect(second.value.files).toHaveLength(first.value.files.length);
		const added = second.value.files.find((file) =>
			file.relativePath.endsWith("Intro.playable"),
		);
		expect(
			await readFile(
				path.join(session.sessionDirectory, added?.backupFileName ?? ""),
				"utf8",
			),
		).toBe("original timeline\n");
	});

	it("refuses a path that escapes the project directory", async () => {
		const { session } = await startSession();

		const result = await registerBackupFiles(session, ["../outside.playable"]);

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("backup-failed");
	});

	it("restores a registered asset only when it actually changed", async () => {
		const { projectPath, session } = await startSession();
		const registered = await registerBackupFiles(session, [
			"Assets/Timelines/Intro.playable",
		]);
		if (!registered.ok) return;
		const assetPath = path.join(
			projectPath,
			"Assets",
			"Timelines",
			"Intro.playable",
		);
		await writeFile(assetPath, "saved by unity\n");

		const restored = await restoreBackupSession(registered.value);

		expect(restored.ok).toBe(true);
		expect(await readFile(assetPath, "utf8")).toBe("original timeline\n");
	});

	it("leaves an unchanged asset untouched during restore", async () => {
		const { projectPath, session } = await startSession();
		const registered = await registerBackupFiles(session, [
			"Assets/Timelines/Intro.playable",
		]);
		if (!registered.ok) return;
		const assetPath = path.join(
			projectPath,
			"Assets",
			"Timelines",
			"Intro.playable",
		);
		// 正常系では Unity は保存しない。書き戻すと中身が同じでも mtime が動き、
		// Unity が次回起動時に再インポートしてしまう
		const before = (await stat(assetPath)).mtimeMs;

		const restored = await restoreBackupSession(registered.value);

		expect(restored.ok).toBe(true);
		expect((await stat(assetPath)).mtimeMs).toBe(before);
		expect(await readFile(assetPath, "utf8")).toBe("original timeline\n");
	});
});

describe("legacy session metadata", () => {
	it("stays assignable without the new optional field", () => {
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
