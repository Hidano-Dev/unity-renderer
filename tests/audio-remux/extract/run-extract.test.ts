import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { runAudioExtraction } from "../../../src/audio-remux/extract/run-extract.js";
import type { HookContext } from "../../../src/hooks/registry.js";

const roots: string[] = [];

async function createContext(
	overrides: Partial<HookContext> = {},
): Promise<{ ctx: HookContext; metadataPath: string }> {
	const sessionDir = await mkdtemp(join(tmpdir(), "audio-extract-"));
	roots.push(sessionDir);
	const ctx: HookContext = {
		handoff: {
			sceneName: "Assets/Main.unity",
			videoPath: "C:\\render\\Main.mp4",
			videoFormat: "mp4",
			additionalOutputs: [],
			effectiveFrameRate: 30,
			inPoint: 0,
			outPoint: 1,
		},
		debug: false,
		sessionDir,
		evalCSharp: async () => ({
			ok: true,
			value: { returnValue: '{"ok":true}' },
		}),
		logger: { debug: () => undefined, warn: () => undefined },
		...overrides,
	};
	return {
		ctx,
		metadataPath: join(sessionDir, "timeline-audio-metadata.json"),
	};
}

afterEach(async () => {
	await Promise.all(
		roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
	);
});

describe("runAudioExtraction", () => {
	it("runs the payload once and confirms the atomic JSON output", async () => {
		let source = "";
		let timeout = 0;
		const { ctx, metadataPath } = await createContext({
			evalCSharp: async (value, valueTimeout) => {
				source = value;
				timeout = valueTimeout;
				await writeFile(metadataPath, "{}", "utf8");
				return {
					ok: true,
					value: { returnValue: '{"ok":true,"clipCount":1}' },
				};
			},
		});

		const result = await runAudioExtraction(ctx, metadataPath);

		expect(result).toEqual({ ok: true, value: undefined });
		expect(timeout).toBe(120);
		expect(source).toContain('"metadataFilePath"');
		expect(source).toContain('"sceneName"');
	});

	it.each([
		[
			"eval-failed",
			{ ok: false, error: { kind: "eval-failed", message: "editor failed" } },
		],
		[
			"eval-timeout",
			{ ok: false, error: { kind: "eval-timeout", message: "timed out" } },
		],
	] as const)("maps %s to the extraction error", async (kind, evalResult) => {
		const { ctx, metadataPath } = await createContext({
			evalCSharp: async () => ({
				...evalResult,
				error: { ...evalResult.error, payloadId: "extract-audio" },
			}),
		});

		const result = await runAudioExtraction(ctx, metadataPath);

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe(kind);
	});

	it("reports a missing output after a successful eval", async () => {
		const { ctx, metadataPath } = await createContext();

		const result = await runAudioExtraction(ctx, metadataPath);

		expect(result).toMatchObject({
			ok: false,
			error: { kind: "output-missing" },
		});
	});

	it("reports a failure returned by the payload", async () => {
		const { ctx, metadataPath } = await createContext({
			evalCSharp: async () => ({
				ok: true,
				value: { returnValue: '{"ok":false,"error":"scene was not found"}' },
			}),
		});

		const result = await runAudioExtraction(ctx, metadataPath);

		expect(result).toMatchObject({
			ok: false,
			error: {
				kind: "payload-reported-failure",
				message: expect.stringContaining("scene was not found"),
			},
		});
	});
});
