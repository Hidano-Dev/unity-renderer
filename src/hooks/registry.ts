import type { OutputFormat } from "../config/schema.js";
import type { EvalResult } from "../editor-session/pipeline-client.js";
import type { Logger } from "../shared/logger.js";
import type { Result } from "../shared/types.js";

/** @impl URC-14.1 @impl URC-14.2 @impl URC-14.3 @impl URC-14.4 */

export interface RenderHandoff {
	readonly sceneName: string;
	readonly videoPath: string;
	/**
	 * `videoPath` のコンテナ形式。`formats` は順序自由で `["mov-prores", "mp4"]`
	 * も有効なため、主出力が mp4 とは限らない。これが無いとフック側は主出力の
	 * コーデックを決められない。
	 */
	readonly videoFormat: OutputFormat;
	readonly additionalOutputs: readonly {
		readonly format: OutputFormat;
		readonly videoPath: string;
	}[];
	readonly effectiveFrameRate: number;
	readonly inPoint: number;
	readonly outPoint: number;
}

export interface HookContext {
	readonly handoff: RenderHandoff;
	readonly debug: boolean;
	readonly sessionDir: string;
	evalCSharp(source: string, timeoutSec: number): Promise<EvalResult>;
	readonly logger: Pick<Logger, "warn" | "debug">;
}

export interface RenderHooks {
	/** 書き出し成功後・Editor 終了前に Scene ごとに呼ばれる。 */
	afterRecording?(ctx: HookContext): Promise<void>;
}

export interface HookFailure {
	readonly kind: "hook-failed";
	readonly message: string;
	readonly cause: unknown;
}

export interface HookRegistry {
	register(hooks: RenderHooks): void;
	readonly current: readonly RenderHooks[];
	runAfterRecording(ctx: HookContext): Promise<Result<void, HookFailure>>;
}

function failureMessage(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

export function createHookRegistry(): HookRegistry {
	const hooks: RenderHooks[] = [];

	return {
		register(hook) {
			hooks.push(hook);
		},
		get current() {
			return hooks.slice();
		},
		async runAfterRecording(ctx) {
			for (const hook of hooks) {
				if (!hook.afterRecording) continue;
				try {
					await hook.afterRecording(ctx);
				} catch (cause) {
					const message = `Hook execution failed: ${failureMessage(cause)}`;
					ctx.logger.warn(message);
					return {
						ok: false,
						error: { kind: "hook-failed", message, cause },
					};
				}
			}
			return { ok: true, value: undefined };
		},
	};
}
