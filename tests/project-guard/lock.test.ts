import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { checkProjectLock } from "../../src/project-guard/lock.js";

const temporaryDirectories: string[] = [];

async function project(): Promise<string> {
	const root = await mkdtemp(path.join(os.tmpdir(), "urc-lock-project-"));
	temporaryDirectories.push(root);
	await mkdir(path.join(root, "Temp"));
	return root;
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((directory) => rm(directory, { recursive: true, force: true })),
	);
});

describe("project lock", () => {
	it("continues when UnityLockfile is absent", async () => {
		const projectPath = await project();

		const result = await checkProjectLock(projectPath);

		expect(result).toEqual({ ok: true, value: undefined });
	});

	it("continues when an existing stale UnityLockfile can be opened exclusively", async () => {
		const projectPath = await project();
		await writeFile(path.join(projectPath, "Temp", "UnityLockfile"), "stale");

		const result = await checkProjectLock(projectPath);

		expect(result).toEqual({ ok: true, value: undefined });
	});

	it("reports a conflict when the lockfile cannot be opened", async () => {
		const projectPath = await project();
		const lockfilePath = path.join(projectPath, "Temp", "UnityLockfile");
		await writeFile(lockfilePath, "active");

		const result = await checkProjectLock(projectPath, {
			open: async () => {
				throw Object.assign(new Error("sharing violation"), {
					code: "EBUSY",
				});
			},
		});

		expect(result).toEqual({
			ok: false,
			error: {
				kind: "project-locked",
				lockfilePath,
				message:
					"The Unity project is already open in another Editor. Close the Editor using this project and try again.",
			},
		});
	});
});
