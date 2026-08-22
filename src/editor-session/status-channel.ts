import { readFile, unlink } from "node:fs/promises";
import { err, ok, type Result } from "../shared/types.js";

export type RecordingStatus =
	| { readonly state: "preparing" }
	| { readonly state: "recording"; readonly elapsedSec: number }
	| { readonly state: "completed"; readonly timelineDurationSec: number }
	| { readonly state: "failed"; readonly reason: string };

export interface StatusChannelError {
	readonly kind: "recording-timeout" | "status-read-failed";
	readonly message: string;
	readonly cause?: unknown;
}

export interface StatusChannelDependencies {
	readonly readFile?: (path: string, encoding: "utf8") => Promise<string>;
	readonly unlink?: (path: string) => Promise<void>;
	readonly sleep?: (milliseconds: number) => Promise<void>;
	readonly now?: () => number;
}

export interface StatusChannel {
	readonly statusFilePath: string;
	poll(
		intervalMs: number,
		timeoutSec: number,
	): Promise<Result<RecordingStatus, StatusChannelError>>;
}

const defaultSleep = (milliseconds: number) =>
	new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

function parseStatus(source: string): RecordingStatus | undefined {
	try {
		const value: unknown = JSON.parse(source);
		if (!value || typeof value !== "object") return undefined;
		const status = value as Record<string, unknown>;
		switch (status.state) {
			case "preparing":
				return { state: "preparing" };
			case "recording":
				return typeof status.elapsedSec === "number" &&
					Number.isFinite(status.elapsedSec) &&
					status.elapsedSec >= 0
					? { state: "recording", elapsedSec: status.elapsedSec }
					: undefined;
			case "completed":
				return typeof status.timelineDurationSec === "number" &&
					Number.isFinite(status.timelineDurationSec) &&
					status.timelineDurationSec >= 0
					? {
							state: "completed",
							timelineDurationSec: status.timelineDurationSec,
						}
					: undefined;
			case "failed":
				return typeof status.reason === "string" && status.reason.length > 0
					? { state: "failed", reason: status.reason }
					: undefined;
			default:
				return undefined;
		}
	} catch {
		return undefined;
	}
}

function isAllowedTransition(
	previous: RecordingStatus | undefined,
	next: RecordingStatus,
): boolean {
	if (!previous) return true;
	if (previous.state === "completed" || previous.state === "failed")
		return false;
	if (previous.state === "preparing")
		return (
			next.state === "preparing" ||
			next.state === "recording" ||
			next.state === "completed" ||
			next.state === "failed"
		);
	return (
		next.state === "recording" ||
		next.state === "completed" ||
		next.state === "failed"
	);
}

export function createStatusChannel(
	statusFilePath: string,
	dependencies: StatusChannelDependencies = {},
): StatusChannel {
	const read =
		dependencies.readFile ?? ((path, encoding) => readFile(path, encoding));
	const remove = dependencies.unlink ?? unlink;
	const sleep = dependencies.sleep ?? defaultSleep;
	const now = dependencies.now ?? Date.now;
	const resetPromise = remove(statusFilePath).catch(() => undefined);

	return {
		statusFilePath,
		async poll(intervalMs, timeoutSec) {
			if (!Number.isFinite(intervalMs) || intervalMs < 0)
				throw new RangeError("intervalMs must be a non-negative finite number");
			if (!Number.isFinite(timeoutSec) || timeoutSec < 0)
				throw new RangeError("timeoutSec must be a non-negative finite number");

			await resetPromise;
			const deadline = now() + timeoutSec * 1_000;
			let previous: RecordingStatus | undefined;
			let previousSource: string | undefined;

			while (now() <= deadline) {
				let source: string;
				try {
					source = await read(statusFilePath, "utf8");
				} catch {
					// The file may be absent or in the middle of an atomic replacement.
					if (now() >= deadline) break;
					await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
					continue;
				}

				const status = parseStatus(source);
				if (
					status &&
					(!previousSource || source !== previousSource) &&
					isAllowedTransition(previous, status)
				) {
					previousSource = source;
					previous = status;
					if (status.state === "completed" || status.state === "failed")
						return ok(status);
				}

				if (now() >= deadline) break;
				await sleep(Math.min(intervalMs, Math.max(0, deadline - now())));
			}

			return err({
				kind: "recording-timeout",
				message: `ステータスファイルが ${timeoutSec} 秒以内に完了状態へ遷移しませんでした: ${statusFilePath}`,
			});
		},
	};
}
