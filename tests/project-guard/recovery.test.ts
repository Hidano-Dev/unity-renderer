import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { beginProjectSession } from "../../src/project-guard/backup.js";
import {
	detectStaleSessions,
	recoverStaleSessions,
	restoreSession,
} from "../../src/project-guard/recovery.js";

const temporaryDirectories: string[] = [];
afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

async function project(includeLock = true): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-recovery-project-"));
	temporaryDirectories.push(root);
	await mkdir(path.join(root, "Packages"));
	await writeFile(
		path.join(root, "Packages", "manifest.json"),
		'{"dependencies":{"base":"1"}}\n',
	);
	if (includeLock)
		await writeFile(
			path.join(root, "Packages", "packages-lock.json"),
			'{"dependencies":{}}\n',
		);
	return root;
}

describe("project recovery", () => {
	it("restores modified files and removes the completed session", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		const started = await beginProjectSession(root, { sessionRoot });
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		await writeFile(
			path.join(root, "Packages", "manifest.json"),
			"corrupted\n",
		);
		// クラッシュした前回実行を模擬: 所有プロセスはもう生きていない
		const isProcessAlive = () => false;
		const recovered = await recoverStaleSessions(root, {
			sessionRoot,
			isProcessAlive,
		});
		expect(recovered.ok).toBe(true);
		expect(
			await readFile(path.join(root, "Packages", "manifest.json"), "utf8"),
		).toBe('{"dependencies":{"base":"1"}}\n');
		expect(
			await detectStaleSessions({ sessionRoot, isProcessAlive }),
		).toHaveLength(0);
	});

	it("deletes a lock file that did not exist before the session", async () => {
		const root = await project(false);
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		const started = await beginProjectSession(root, { sessionRoot });
		expect(started.ok).toBe(true);
		if (!started.ok) return;
		await writeFile(
			path.join(root, "Packages", "packages-lock.json"),
			"temporary\n",
		);
		expect((await restoreSession(started.value)).ok).toBe(true);
		await expect(
			readFile(path.join(root, "Packages", "packages-lock.json")),
		).rejects.toThrow();
	});

	it("protects a live session owned by this very process (in-process concurrency)", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		// beginProjectSession は既定で process.pid を ownerPid に記録する
		const started = await beginProjectSession(root, { sessionRoot });
		expect(started.ok).toBe(true);

		// 自プロセスは生存中なので、既定の生存判定でも復旧対象にならない
		expect(await detectStaleSessions({ sessionRoot })).toHaveLength(0);
		const guarded = await recoverStaleSessions(root, { sessionRoot });
		expect(guarded).toMatchObject({ ok: true, value: [] });
	});

	it("does not treat a session owned by a live process as stale", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		const started = await beginProjectSession(root, {
			sessionRoot,
			ownerPid: 99999,
		});
		expect(started.ok).toBe(true);

		// 所有プロセス生存中 → 実行中セッションであり復旧対象にしない
		expect(
			await detectStaleSessions({ sessionRoot, isProcessAlive: () => true }),
		).toHaveLength(0);
		const guarded = await recoverStaleSessions(root, {
			sessionRoot,
			isProcessAlive: () => true,
		});
		expect(guarded).toMatchObject({ ok: true, value: [] });

		// 所有プロセス消滅後 → クラッシュ残骸として復旧する
		expect(
			await detectStaleSessions({ sessionRoot, isProcessAlive: () => false }),
		).toHaveLength(1);
		const recovered = await recoverStaleSessions(root, {
			sessionRoot,
			isProcessAlive: () => false,
		});
		expect(recovered.ok).toBe(true);
		if (recovered.ok) expect(recovered.value).toHaveLength(1);
	});

	it("rejects a second session while the first is active", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		expect((await beginProjectSession(root, { sessionRoot })).ok).toBe(true);
		const second = await beginProjectSession(root, { sessionRoot });
		expect(second.ok).toBe(false);
	});

	it("recovers on a first run where the session root does not exist yet", async () => {
		const root = await project();
		const parent = await mkdtemp(path.join(os.tmpdir(), "urc-recovery-fresh-"));
		temporaryDirectories.push(parent);
		// 初回実行を模擬: sessions ディレクトリがまだ無い
		const sessionRoot = path.join(parent, "sessions");

		const recovered = await recoverStaleSessions(root, { sessionRoot });

		expect(recovered).toMatchObject({ ok: true, value: [] });
	});

	it("restores the manifest when the session start fails after patching", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		const manifest = path.join(root, "Packages", "manifest.json");
		const before = await readFile(manifest, "utf8");

		const failed = await beginProjectSession(root, {
			sessionRoot,
			writeSession: async () => {
				throw new Error("disk full");
			},
		});

		expect(failed.ok).toBe(false);
		// 一時パッケージを含む manifest がプロジェクトに残っていないこと
		expect(await readFile(manifest, "utf8")).toBe(before);
		// 次回実行を妨げる active セッションも残らない
		expect(await detectStaleSessions({ sessionRoot })).toHaveLength(0);
	});

	it("treats alias paths of one project as the same session", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		// 同じプロジェクトをドライブ文字の大小違い等の別名で指定したケース
		const alias =
			process.platform === "win32"
				? root.charAt(0).toLowerCase() === root.charAt(0)
					? root.charAt(0).toUpperCase() + root.slice(1)
					: root.charAt(0).toLowerCase() + root.slice(1)
				: root;
		expect((await beginProjectSession(root, { sessionRoot })).ok).toBe(true);

		// 別名でも同一プロジェクトと判定し、二重に manifest を触らせない
		const viaAlias = await beginProjectSession(alias, { sessionRoot });
		expect(viaAlias.ok).toBe(false);
	});
});
