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

	it("serializes simultaneous session starts so exactly one wins", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		// begin ロックがチェック→作成区間を直列化し、二重 active session を防ぐ
		const results = await Promise.all([
			beginProjectSession(root, { sessionRoot }),
			beginProjectSession(root, { sessionRoot }),
		]);
		expect(results.filter((result) => result.ok)).toHaveLength(1);
	});

	it("steals a begin lock only when the owner is dead and the lock has aged", async () => {
		const root = await project();
		const sessionRoot = await mkdtemp(
			path.join(os.tmpdir(), "urc-recovery-sessions-"),
		);
		temporaryDirectories.push(sessionRoot);
		const { createHash } = await import("node:crypto");
		const { utimes } = await import("node:fs/promises");
		const hash = createHash("sha256")
			.update(path.resolve(root))
			.digest("hex")
			.slice(0, 12);
		const lockPath = path.join(sessionRoot, `${hash}.begin.lock`);
		await writeFile(lockPath, JSON.stringify({ pid: 99999 }));

		// 所有プロセス生存中 → 同時実行として拒否
		const refusedAlive = await beginProjectSession(root, {
			sessionRoot,
			isProcessAlive: () => true,
		});
		expect(refusedAlive.ok).toBe(false);

		// 所有プロセス死亡でも mtime が新しい → 終了処理直後の可能性があり拒否
		const refusedFresh = await beginProjectSession(root, {
			sessionRoot,
			isProcessAlive: () => false,
		});
		expect(refusedFresh.ok).toBe(false);
		if (!refusedFresh.ok)
			expect(refusedFresh.error.message).toContain("再実行");

		// 所有プロセス死亡 + 老朽閾値超過 → 残骸として奪取
		const aged = new Date(Date.now() - 60_000);
		await utimes(lockPath, aged, aged);
		const stolen = await beginProjectSession(root, {
			sessionRoot,
			isProcessAlive: () => false,
		});
		expect(stolen.ok).toBe(true);
		// 奪取したロックは自分の所有として作り直され、完了時に解放されている
		await expect(readFile(lockPath)).rejects.toThrow();
	});
});
