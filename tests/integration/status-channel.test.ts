import { mkdtemp, rename, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createStatusChannel } from "../../src/editor-session/status-channel.js";

async function runStatus(status: object | undefined) {
	const root = await mkdtemp(path.join(tmpdir(), "unity-status-integration-"));
	const statusPath = path.join(root, "status.json");
	let writer: Promise<void> | undefined;
	try {
		if (status) {
			const temporary = `${statusPath}.tmp`;
			writer = new Promise<void>((resolve, reject) =>
				setTimeout(async () => {
					try {
						await writeFile(statusPath, '{"state":"recording"', "utf8");
						await new Promise((resolve) => setTimeout(resolve, 5));
						await writeFile(temporary, JSON.stringify(status), "utf8");
						await unlink(statusPath);
						await rename(temporary, statusPath);
						resolve();
					} catch (error) {
						reject(error);
					}
				}, 0),
			);
		}
		const result = await createStatusChannel(statusPath).poll(
			2,
			status ? 0.5 : 0.02,
		);
		await writer;
		return result;
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

describe("status-channel integration", () => {
	it("skips partial writes and observes a completed status", async () => {
		await expect(
			runStatus({ state: "completed", timelineDurationSec: 12.5 }),
		).resolves.toEqual({
			ok: true,
			value: { state: "completed", timelineDurationSec: 12.5 },
		});
	});

	it("observes a failed status as a recording result", async () => {
		await expect(
			runStatus({ state: "failed", reason: "Recorder error" }),
		).resolves.toEqual({
			ok: true,
			value: { state: "failed", reason: "Recorder error" },
		});
	});

	it("returns a timeout when no terminal status is written", async () => {
		await expect(runStatus(undefined)).resolves.toEqual({
			ok: false,
			error: expect.objectContaining({ kind: "recording-timeout" }),
		});
	});
});
