/** @impl URC-13.1 @impl URC-13.2 @impl URC-13.3 */

export interface SceneResult {
	readonly sceneName: string;
	readonly outcome: "success" | "failure";
	readonly warnings: readonly string[];
	readonly outputs: readonly {
		readonly format: string;
		readonly videoPath: string;
	}[];
	readonly durationSec: number;
}

export interface BatchResult {
	readonly scenes: readonly SceneResult[];
	readonly restoreSucceeded: boolean;
}

export interface ProgressReporter {
	sceneStarted(sceneName: string, index: number, total: number): void;
	sceneFinished(result: SceneResult): void;
	batchSummary(result: BatchResult): void;
	warn(message: string): void;
	debug(message: string): void;
}

export interface ProgressReporterOptions {
	readonly debug?: boolean;
	readonly isTTY?: boolean;
	readonly write?: (message: string) => void;
}

function outputName(path: string): string {
	return path.split(/[\\/]/u).at(-1) ?? path;
}

function fileUri(path: string): string {
	const normalized = path.replaceAll("\\", "/");
	if (/^[A-Za-z]:\//u.test(normalized)) {
		return `file:///${normalized[0]?.toUpperCase() ?? ""}:${encodePath(normalized.slice(2))}`;
	}
	return `file://${encodePath(normalized)}`;
}

function encodePath(path: string): string {
	return path
		.split("/")
		.map((part) => encodeURIComponent(part))
		.join("/");
}

export function formatExplorerLink(path: string, isTTY: boolean): string {
	if (!isTTY) return path;
	const label = outputName(path);
	return `\u001b]8;;${fileUri(path)}\u001b\\${label}\u001b]8;;\u001b\\`;
}

export function createProgressReporter(
	options: ProgressReporterOptions = {},
): ProgressReporter {
	const isTTY = options.isTTY ?? process.stdout.isTTY === true;
	const debugEnabled = options.debug === true;
	const write =
		options.write ?? ((message: string) => process.stdout.write(message));
	const emit = (message: string): void => write(`${message}\n`);

	return {
		sceneStarted: (sceneName, index, total) =>
			emit(`Scene ${index}/${total}: ${sceneName} を実行中`),
		sceneFinished: (result) => {
			emit(
				`${result.sceneName}: ${result.outcome === "success" ? "成功" : "失敗"} (${result.durationSec.toFixed(2)}s)`,
			);
			for (const output of result.outputs) {
				emit(`出力: ${formatExplorerLink(output.videoPath, isTTY)}`);
			}
		},
		batchSummary: (result) => {
			emit("バッチ結果:");
			for (const scene of result.scenes) {
				emit(
					`- ${scene.sceneName}: ${scene.outcome === "success" ? "成功" : "失敗"}`,
				);
			}
			if (!result.restoreSucceeded) emit("原状復帰: 失敗");
		},
		warn: (message) => emit(`警告: ${message}`),
		debug: (message) => {
			if (debugEnabled) emit(`[debug] ${message}`);
		},
	};
}
