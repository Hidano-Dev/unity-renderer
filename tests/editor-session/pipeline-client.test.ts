import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createPipelineClient,
	type PipelineClientDependencies,
} from "../../src/editor-session/pipeline-client.js";

const payload = { id: "open-scene" as const, source: "return 42;" };

describe("PipelineClient", () => {
	let sessionDir: string;

	afterEach(async () => {
		if (sessionDir) await rm(sessionDir, { recursive: true, force: true });
	});

	function setup(overrides: Partial<PipelineClientDependencies> = {}) {
		return createPipelineClient({
			projectPath: "C:\\projects\\demo",
			sessionDir,
			sleep: vi.fn(async () => undefined),
			...overrides,
		});
	}

	it("uses eval_file and removes the atomic temporary payload after success", async () => {
		sessionDir = await mkdtemp(join(tmpdir(), "pipeline-client-"));
		const execute = vi.fn(async () => ({
			stdout: JSON.stringify({ result: { success: true, result: 42 } }),
			stderr: "",
			exitCode: 0,
		}));
		const result = await setup({ execute }).eval(payload, {
			timeoutSec: 7,
			transport: { kind: "file" },
		});

		expect(result).toEqual({ ok: true, value: { returnValue: "42" } });
		expect(execute).toHaveBeenCalledWith(
			"unity",
			[
				"command",
				"eval_file",
				"--project-path",
				"C:\\projects\\demo",
				expect.any(String),
				"--timeout",
				"7000",
				"--format",
				"json",
			],
			{ windowsHide: true },
		);
		expect(
			await (await import("node:fs/promises")).readdir(sessionDir),
		).toEqual([]);
	});

	it("accepts the Unity CLI JSON envelope", async () => {
		sessionDir = await mkdtemp(join(tmpdir(), "pipeline-client-"));
		const execute = vi.fn(async () => ({
			stdout: JSON.stringify({
				data: { result: { success: true, result: 42 } },
			}),
			stderr: "",
			exitCode: 0,
		}));
		const result = await setup({ execute }).eval(payload, {
			timeoutSec: 7,
			transport: { kind: "inline" },
		});

		expect(result).toEqual({ ok: true, value: { returnValue: "42" } });
	});

	it("retries transport failures three times and classifies the exhausted error", async () => {
		sessionDir = await mkdtemp(join(tmpdir(), "pipeline-client-"));
		const execute = vi.fn().mockRejectedValue(new Error("ECONNRESET"));
		const result = await setup({ execute }).eval(payload, {
			timeoutSec: 5,
			transport: { kind: "file" },
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("eval-transport-failed");
		expect(execute).toHaveBeenCalledTimes(3);
	});

	it("does not retry an accepted payload that fails in C#", async () => {
		sessionDir = await mkdtemp(join(tmpdir(), "pipeline-client-"));
		const execute = vi.fn(async () => ({
			stdout: JSON.stringify({
				result: { success: false, error: "compile error" },
			}),
			stderr: "",
			exitCode: 6,
		}));
		const result = await setup({ execute }).eval(payload, {
			timeoutSec: 5,
			transport: { kind: "file" },
		});

		expect(execute).toHaveBeenCalledTimes(1);
		expect(result).toEqual(expect.objectContaining({ ok: false }));
		if (!result.ok) expect(result.error.kind).toBe("eval-failed");
	});

	it("keeps the payload in debug mode after a failure and logs the response", async () => {
		sessionDir = await mkdtemp(join(tmpdir(), "pipeline-client-"));
		const logs: string[] = [];
		const execute = vi.fn(async () => ({
			stdout: "bad",
			stderr: "oops",
			exitCode: 6,
		}));
		const result = await setup({
			execute,
			debug: true,
			log: (message) => logs.push(message),
		}).eval(payload, {
			timeoutSec: 5,
			transport: { kind: "file" },
		});

		expect(result.ok).toBe(false);
		expect(
			await (await import("node:fs/promises")).readdir(sessionDir),
		).toHaveLength(1);
		expect(logs.join("\n")).toContain("open-scene");
		expect(logs.join("\n")).toContain("bad");
	});
});
