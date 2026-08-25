import { err, ok, type Result } from "../shared/types.js";

/**
 * 録画前に Timeline から取り除く RecorderTrack の扱い。
 *
 * 書き出しの Recorder 構成は Play Mode 内の RecorderController が組み立てる
 * (`start-recording.cs`)。利用者が Timeline へ手で置いた RecorderTrack はそれと
 * 並行して走り、独自の出力先へ書き出してしまうため、録画設定を作る前に外す。
 *
 * 削除は Unity のメモリ上だけで行い、保存はしない(`quit-editor.cs` は保存せず
 * 終了する)。それでも「万一 Editor 側がアセットを保存した」場合に備え、削除前に
 * 対象の Timeline アセットをセッションへバックアップしてから進める。
 */
export interface RecorderTrackTimeline {
	/** プロジェクト相対の Timeline アセットパス。解決できなければ空文字。 */
	readonly assetPath: string;
	/** root からの ControlTrack 経路。ネストのどこで見つかったかを示す。 */
	readonly chain: string;
	readonly tracks: readonly string[];
}

export interface RecorderTrackReport {
	readonly mode: "scan" | "remove";
	readonly timelines: readonly RecorderTrackTimeline[];
	readonly removed: number;
	readonly timelineDurationSec: number | null;
	readonly timelineFrameRate: number | null;
	readonly warnings: readonly string[];
}

export interface RecorderTrackCleanup {
	readonly removed: number;
	readonly warnings: readonly string[];
	/**
	 * 削除後の Timeline 長。RecorderTrack のクリップが Timeline 末尾を伸ばして
	 * いた場合、削除で短くなる。null なら Unity 側が値を返さなかった。
	 */
	readonly timelineDurationSec: number | null;
}

export interface RecorderTrackCleanupDeps {
	readonly evalPayload: (
		mode: "scan" | "remove",
	) => Promise<Result<string, { readonly message: string }>>;
	/**
	 * 削除前に Timeline アセットをバックアップへ登録する。未指定なら保険なしで
	 * 進んだことを警告として残す。
	 */
	readonly registerBackups?: (
		relativePaths: readonly string[],
	) => Promise<Result<void, { readonly message: string }>>;
}

function asStringArray(value: unknown): string[] {
	return Array.isArray(value)
		? value.filter((entry): entry is string => typeof entry === "string")
		: [];
}

function asFiniteNumber(value: unknown): number | null {
	return typeof value === "number" && Number.isFinite(value) ? value : null;
}

export function parseRecorderTrackReport(
	value: string,
): Result<RecorderTrackReport, { readonly message: string }> {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value) as unknown;
	} catch {
		return err({ message: "recorder-tracks payload returned invalid JSON" });
	}
	if (typeof parsed !== "object" || parsed === null)
		return err({ message: "recorder-tracks payload returned invalid JSON" });
	const record = parsed as Record<string, unknown>;
	if (record.ok !== true)
		return err({
			message:
				typeof record.error === "string"
					? record.error
					: "recorder-tracks payload failed",
		});
	const timelines: RecorderTrackTimeline[] = [];
	if (Array.isArray(record.timelines))
		for (const entry of record.timelines) {
			if (typeof entry !== "object" || entry === null) continue;
			const timeline = entry as Record<string, unknown>;
			timelines.push({
				assetPath:
					typeof timeline.assetPath === "string" ? timeline.assetPath : "",
				chain: typeof timeline.chain === "string" ? timeline.chain : "root",
				tracks: asStringArray(timeline.tracks),
			});
		}
	return ok({
		mode: record.mode === "remove" ? "remove" : "scan",
		timelines,
		removed: asFiniteNumber(record.removed) ?? 0,
		timelineDurationSec: asFiniteNumber(record.timelineDurationSec),
		timelineFrameRate: asFiniteNumber(record.timelineFrameRate),
		warnings: asStringArray(record.warnings),
	});
}

function describeTimeline(timeline: RecorderTrackTimeline): string {
	const where =
		timeline.chain === "root"
			? timeline.assetPath || "root Timeline"
			: `${timeline.assetPath || "nested Timeline"} (${timeline.chain})`;
	return `${where}: ${timeline.tracks.join(", ")}`;
}

/**
 * scan で対象を洗い出し、バックアップを取ってから remove を実行する。
 * scan の時点で 0 件なら Unity 側を一切変更しない。
 */
export async function cleanRecorderTracks(
	dependencies: RecorderTrackCleanupDeps,
): Promise<Result<RecorderTrackCleanup, { readonly message: string }>> {
	const scanned = await dependencies.evalPayload("scan");
	if (!scanned.ok) return err({ message: scanned.error.message });
	const scan = parseRecorderTrackReport(scanned.value);
	if (!scan.ok) return scan;

	const warnings = [...scan.value.warnings];
	if (scan.value.timelines.length === 0)
		return ok({
			removed: 0,
			warnings,
			timelineDurationSec: scan.value.timelineDurationSec,
		});

	const assetPaths = scan.value.timelines
		.map((timeline) => timeline.assetPath)
		.filter((assetPath) => assetPath !== "");
	if (dependencies.registerBackups) {
		const registered = await dependencies.registerBackups(assetPaths);
		if (!registered.ok) return err({ message: registered.error.message });
	} else {
		warnings.push(
			"RecorderTrack を削除しましたが、Timeline アセットのバックアップは取得していません。",
		);
	}

	const removedResult = await dependencies.evalPayload("remove");
	if (!removedResult.ok) return err({ message: removedResult.error.message });
	const removed = parseRecorderTrackReport(removedResult.value);
	if (!removed.ok) return removed;

	for (const warning of removed.value.warnings)
		if (!warnings.includes(warning)) warnings.push(warning);
	for (const timeline of removed.value.timelines)
		warnings.push(
			`録画前に RecorderTrack を一時的に外しました — ${describeTimeline(timeline)}`,
		);

	return ok({
		removed: removed.value.removed,
		warnings,
		timelineDurationSec: removed.value.timelineDurationSec,
	});
}
