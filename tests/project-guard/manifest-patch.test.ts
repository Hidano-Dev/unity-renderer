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

	// Unity は BOM を付けないが、PowerShell 5.1 の `Set-Content -Encoding UTF8`
	// などで書き換えると付く。JSON.parse は先頭の U+FEFF を受け付けないため、
	// 落とさないと「Temporary package addition failed.」の 1 行で行き止まりになる。
	it("patches a manifest written with a UTF-8 BOM", async () => {
		const projectPath = await project();
		const manifestPath = path.join(projectPath, "Packages", "manifest.json");
		await writeFile(
			manifestPath,
			`\uFEFF{"dependencies":{"com.example.base":"1.0.0"}}\n`,
			"utf8",
		);

		const result = await patchManifest(projectPath);

		expect(result.ok).toBe(true);
		const written = await readFile(manifestPath, "utf8");
		// 書き戻しは BOM 無しの UTF-8。Unity が読む側なので付け直さない
		expect(written.startsWith("\uFEFF")).toBe(false);
		expect(
			(JSON.parse(written) as { dependencies: Record<string, string> })
				.dependencies,
		).toMatchObject({
			"com.example.base": "1.0.0",
			"com.unity.recorder": "5.1.0",
			"com.unity.pipeline": "0.5.0-exp.1",
		});
	});

	// 失敗の理由を握り潰すと、権限・欠落・構文のどれなのか利用者に伝わらない。
	it("reports the underlying cause and the manifest path when it fails", async () => {
		const projectPath = await project();
		await writeFile(
			path.join(projectPath, "Packages", "manifest.json"),
			'{"dependencies":',
		);

		const broken = await patchManifest(projectPath);
		expect(broken.ok).toBe(false);
		if (broken.ok) return;
		expect(broken.error.kind).toBe("manifest-patch-failed");
		expect(broken.error.message).toContain(
			path.join(projectPath, "Packages", "manifest.json"),
		);
		// 素の "Temporary package addition failed." では原因が追えない
		expect(broken.error.message.length).toBeGreaterThan(
			"Temporary package addition failed.".length,
		);
		expect(broken.error.cause).toBeInstanceOf(Error);

		const missing = await patchManifest(
			path.join(projectPath, "no-such-project"),
		);
		expect(missing.ok).toBe(false);
		if (missing.ok) return;
		expect(missing.error.message).toContain("ENOENT");
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
