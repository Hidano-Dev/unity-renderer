import { runCheck as runCheckDefault } from "../cli/check.js";
import { createCompositionHooks } from "../cli/composition.js";
import { runRender as runRenderDefault } from "../cli/render.js";
import { err, ok, type Result } from "../shared/types.js";
import {
	buildRenderConfigDraft,
	type ConfigDraftIssue,
	writeRenderConfigFile,
} from "./config-draft.js";
import type { GuiState } from "./state.js";

export type RunMode = "check" | "render";

export type RunEvent =
	| { readonly type: "started"; readonly mode: RunMode }
	| { readonly type: "log"; readonly line: string }
	| {
			readonly type: "finished";
			readonly mode: RunMode;
			readonly exitCode: number;
	  };

/** 遅れて接続した画面にも直前の経緯が見えるよう、この件数だけ保持する。 */
const BACKLOG_LIMIT = 500;

export interface GuiRunnerDeps {
	readonly configPath: string;
	readonly runCheck?: typeof runCheckDefault;
	readonly runRender?: typeof runRenderDefault;
	readonly writeConfig?: typeof writeRenderConfigFile;
}

function describeExit(mode: RunMode, exitCode: number): string {
	if (exitCode === 0)
		return mode === "check" ? "事前チェック: 成功" : "書き出し: 成功";
	if (mode === "check") return "事前チェック: 失敗";
	if (exitCode === 2) return "書き出し: 一部の Scene が失敗しました";
	if (exitCode === 3)
		return "書き出し: 失敗（プロジェクト設定の復元に失敗しました。Packages/manifest.json を確認してください）";
	return "書き出し: 失敗";
}

/**
 * 同時に走らせてよい実行は 1 本だけ。Unity Pipeline のポート 7800 が固定で、
 * ツール自体が「1 台で 1 つの render」前提のため、GUI 側でも直列化する。
 */
export class GuiRunner {
	readonly #deps: GuiRunnerDeps;
	readonly #listeners = new Set<(event: RunEvent) => void>();
	readonly #backlog: RunEvent[] = [];
	#running = false;

	constructor(deps: GuiRunnerDeps) {
		this.#deps = deps;
	}

	get running(): boolean {
		return this.#running;
	}

	subscribe(listener: (event: RunEvent) => void): () => void {
		for (const event of this.#backlog) listener(event);
		this.#listeners.add(listener);
		return () => {
			this.#listeners.delete(listener);
		};
	}

	#emit(event: RunEvent): void {
		this.#backlog.push(event);
		if (this.#backlog.length > BACKLOG_LIMIT) this.#backlog.shift();
		for (const listener of this.#listeners) listener(event);
	}

	log(line: string): void {
		this.#emit({ type: "log", line });
	}

	/**
	 * 設定を組み立てて実行を開始する。設定不備は開始せずに呼び出し元へ返し、
	 * 実行が始まった後の進捗はイベントで流す。
	 */
	async start(
		mode: RunMode,
		state: GuiState,
		selectedScenes: readonly string[],
	): Promise<
		Result<{ readonly configPath: string }, readonly ConfigDraftIssue[]>
	> {
		if (this.#running)
			return err([
				{ path: "$", message: "すでに実行中です。完了までお待ちください。" },
			]);
		// 設定ファイルの書き込みより後で立てると、その await の間に届いた 2 本目の
		// 要求も上のガードを通り抜ける。両方が同じ設定ファイルを上書きしたまま
		// 実行に入ると、先行実行が後続の設定を読み、固定ポート 7800 と対象
		// プロジェクトを 2 つの Editor で奪い合う
		this.#running = true;

		const draft = buildRenderConfigDraft(state, selectedScenes);
		if (!draft.ok) {
			this.#running = false;
			return draft;
		}

		const configPath = this.#deps.configPath;
		try {
			await (this.#deps.writeConfig ?? writeRenderConfigFile)(
				configPath,
				draft.value,
			);
		} catch (cause) {
			this.#running = false;
			return err([
				{
					path: "$",
					message: `設定ファイルを保存できませんでした (${configPath}): ${cause instanceof Error ? cause.message : String(cause)}`,
				},
			]);
		}

		this.#backlog.length = 0;
		this.#emit({ type: "started", mode });
		this.log(`設定ファイル: ${configPath}`);
		this.log(
			`対象 Scene (${selectedScenes.length} 件): ${selectedScenes.join(", ")}`,
		);

		void this.#execute(mode);
		return ok({ configPath });
	}

	async #execute(mode: RunMode): Promise<void> {
		const write = (message: string): void => {
			// runRender / runCheck は 1 メッセージ 1 行とは限らないので、行ごとに割る
			for (const line of message.split(/\r?\n/u)) {
				if (line !== "") this.log(line);
			}
		};
		let exitCode = 1;
		try {
			exitCode =
				mode === "check"
					? await (this.#deps.runCheck ?? runCheckDefault)(
							this.#deps.configPath,
							{ write },
						)
					: await (this.#deps.runRender ?? runRenderDefault)(
							this.#deps.configPath,
							{
								write,
								hooks: createCompositionHooks(),
								isTTY: false,
								interactive: false,
							},
						);
		} catch (cause) {
			this.log(
				`Error: ${cause instanceof Error ? cause.message : String(cause)}`,
			);
			exitCode = 1;
		} finally {
			this.log(describeExit(mode, exitCode));
			this.#running = false;
			this.#emit({ type: "finished", mode, exitCode });
		}
	}
}
