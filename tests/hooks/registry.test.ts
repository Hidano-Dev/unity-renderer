import { describe, expect, it, vi } from "vitest";
import {
	createHookRegistry,
	type HookContext,
	type RenderHandoff,
} from "../../src/hooks/registry.js";

const handoff: RenderHandoff = {
	sceneName: "Intro",
	videoPath: "C:\\renders\\Intro.mp4",
	additionalOutputs: [
		{ format: "mov-prores", videoPath: "C:\\renders\\Intro.mov" },
	],
	effectiveFrameRate: 29.97,
	inPoint: 1.5,
	outPoint: 12.25,
};

const context = (overrides: Partial<HookContext> = {}): HookContext => ({
	handoff,
	debug: false,
	sessionDir: "C:\\sessions\\run-1",
	evalCSharp: vi.fn(),
	logger: { warn: vi.fn(), debug: vi.fn() },
	...overrides,
});

describe("HookRegistry", () => {
	it("skips the hook phase when no hooks are registered", async () => {
		const registry = createHookRegistry();
		const ctx = context();

		await expect(registry.runAfterRecording(ctx)).resolves.toEqual({
			ok: true,
		});
		expect(registry.current).toEqual([]);
	});

	it("runs registered hooks in registration order and awaits each one", async () => {
		const registry = createHookRegistry();
		const events: string[] = [];
		const first = vi.fn(async () => {
			events.push("first:start");
			await Promise.resolve();
			events.push("first:end");
		});
		const second = vi.fn(async (): Promise<void> => {
			events.push("second");
		});
		registry.register({ afterRecording: first });
		registry.register({ afterRecording: second });
		const ctx = context();

		await expect(registry.runAfterRecording(ctx)).resolves.toEqual({
			ok: true,
		});
		expect(events).toEqual(["first:start", "first:end", "second"]);
		expect(first).toHaveBeenCalledWith(ctx);
		expect(second).toHaveBeenCalledWith(ctx);
	});

	it("returns hook-failed and skips later hooks when a hook rejects", async () => {
		const registry = createHookRegistry();
		const failure = new Error("audio extraction failed");
		const later = vi.fn(async () => undefined);
		registry.register({
			afterRecording: vi.fn(async () => {
				throw failure;
			}),
		});
		registry.register({ afterRecording: later });
		const ctx = context();

		await expect(registry.runAfterRecording(ctx)).resolves.toMatchObject({
			ok: false,
			error: {
				kind: "hook-failed",
				message: "Hook execution failed: audio extraction failed",
				cause: failure,
			},
		});
		expect(later).not.toHaveBeenCalled();
		expect(ctx.logger.warn).toHaveBeenCalledWith(
			"Hook execution failed: audio extraction failed",
		);
	});
});
