import { describe, expect, it, vi } from "vitest";
import type { RenderConfig } from "../../src/config/schema.js";
import { GuiRunner, type RunEvent } from "../../src/gui/runner.js";
import { defaultGuiState, type GuiState } from "../../src/gui/state.js";

const CONFIG_PATH = "D:\\work\\render-config.json";

const ready: GuiState = {
	...defaultGuiState,
	projectPath: "D:\\proj",
	outputDirectory: "D:\\out",
};

function record(runner: GuiRunner): {
	events: RunEvent[];
	finished: Promise<RunEvent[]>;
} {
	const events: RunEvent[] = [];
	const finished = new Promise<RunEvent[]>((resolve) => {
		const unsubscribe = runner.subscribe((event) => {
			events.push(event);
			if (event.type === "finished") {
				unsubscribe();
				resolve(events);
			}
		});
	});
	return { events, finished };
}

function logLines(events: readonly RunEvent[]): string[] {
	return events
		.filter(
			(event): event is Extract<RunEvent, { type: "log" }> =>
				event.type === "log",
		)
		.map((event) => event.line);
}

describe("GuiRunner", () => {
	it("refuses to start and writes nothing when the settings are incomplete", async () => {
		const writeConfig = vi.fn();
		const runCheck = vi.fn();
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig,
			runCheck,
		});

		const started = await runner.start("check", defaultGuiState, []);

		expect(started.ok).toBe(false);
		expect(writeConfig).not.toHaveBeenCalled();
		expect(runCheck).not.toHaveBeenCalled();
		expect(runner.running).toBe(false);
	});

	it("writes the built config and reports success", async () => {
		const writeConfig = vi.fn(
			async (_configPath: string, _config: RenderConfig) => {},
		);
		const runCheck = vi.fn(async () => 0 as const);
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig,
			runCheck,
		});
		const { finished } = record(runner);

		const started = await runner.start("check", ready, ["Main"]);
		expect(started).toEqual({ ok: true, value: { configPath: CONFIG_PATH } });

		const events = await finished;
		expect(writeConfig.mock.calls[0]?.[0]).toBe(CONFIG_PATH);
		expect(writeConfig.mock.calls[0]?.[1].scenes).toEqual(["Main"]);
		expect(runCheck).toHaveBeenCalledWith(CONFIG_PATH, expect.anything());
		expect(events[0]).toEqual({ type: "started", mode: "check" });
		expect(events.at(-1)).toEqual({
			type: "finished",
			mode: "check",
			exitCode: 0,
		});
		expect(logLines(events)).toContain("事前チェック: 成功");
		expect(runner.running).toBe(false);
	});

	it("splits multi-line output into separate log events", async () => {
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck: async (_config, dependencies) => {
				dependencies?.write?.("一行目\n二行目\n");
				return 0;
			},
		});
		const { finished } = record(runner);

		await runner.start("check", ready, ["Main"]);

		expect(logLines(await finished)).toEqual(
			expect.arrayContaining(["一行目", "二行目"]),
		);
	});

	it("explains a failed restore (exit code 3) instead of showing a bare number", async () => {
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runRender: async () => 3,
		});
		const { finished } = record(runner);

		await runner.start("render", ready, ["Main"]);
		const events = await finished;

		expect(events.at(-1)).toEqual({
			type: "finished",
			mode: "render",
			exitCode: 3,
		});
		expect(logLines(events).at(-1)).toContain("manifest.json");
	});

	it("turns a thrown error into a log line and a failed run", async () => {
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck: async () => {
				throw new Error("boom");
			},
		});
		const { finished } = record(runner);

		await runner.start("check", ready, ["Main"]);
		const events = await finished;

		expect(logLines(events)).toContain("Error: boom");
		expect(events.at(-1)).toEqual({
			type: "finished",
			mode: "check",
			exitCode: 1,
		});
	});

	it("rejects a second run while one is in flight", async () => {
		let release = (): void => {};
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck: async () => {
				await gate;
				return 0;
			},
		});
		const { finished } = record(runner);

		await runner.start("check", ready, ["Main"]);
		expect(runner.running).toBe(true);

		const second = await runner.start("check", ready, ["Main"]);
		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.error[0]?.message).toContain("すでに実行中");

		release();
		await finished;
		expect(runner.running).toBe(false);
	});

	it("rejects a second run that arrives while the config is still being written", async () => {
		let releaseWrite = (): void => {};
		const writeGate = new Promise<void>((resolve) => {
			releaseWrite = resolve;
		});
		const writeConfig = vi.fn(
			async (_configPath: string, _config: RenderConfig) => {
				await writeGate;
			},
		);
		const runCheck = vi.fn(async () => 0 as const);
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig,
			runCheck,
		});
		const { finished } = record(runner);

		// 1 本目を await せずに 2 本目を投げる。設定の書き込み中もロックされて
		// いないと、両方が同じ設定ファイルを上書きしたまま 2 本走ってしまう
		const first = runner.start("check", ready, ["Main"]);
		const second = await runner.start("check", ready, ["Other"]);

		expect(second.ok).toBe(false);
		if (!second.ok) expect(second.error[0]?.message).toContain("すでに実行中");

		releaseWrite();
		expect((await first).ok).toBe(true);
		await finished;

		expect(writeConfig).toHaveBeenCalledTimes(1);
		expect(writeConfig.mock.calls[0]?.[1].scenes).toEqual(["Main"]);
		expect(runCheck).toHaveBeenCalledTimes(1);
	});

	it("reports a config write failure without starting the run", async () => {
		const runCheck = vi.fn();
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {
				throw new Error("EACCES");
			},
			runCheck,
		});

		const started = await runner.start("check", ready, ["Main"]);

		expect(started.ok).toBe(false);
		if (!started.ok)
			expect(started.error[0]?.message).toContain(
				"設定ファイルを保存できませんでした",
			);
		expect(runCheck).not.toHaveBeenCalled();
		// 書き込みに失敗した実行がロックを握ったままだと、以後どの実行も
		// 「すでに実行中」で弾かれ続ける
		expect(runner.running).toBe(false);
	});

	it("replays the backlog to a listener that connects late", async () => {
		const runner = new GuiRunner({
			configPath: CONFIG_PATH,
			writeConfig: async () => {},
			runCheck: async () => 0,
		});
		const { finished } = record(runner);
		await runner.start("check", ready, ["Main"]);
		await finished;

		const replayed: RunEvent[] = [];
		runner.subscribe((event) => replayed.push(event));

		expect(replayed[0]).toEqual({ type: "started", mode: "check" });
		expect(replayed.at(-1)).toEqual({
			type: "finished",
			mode: "check",
			exitCode: 0,
		});
	});
});
