import { execFile } from "node:child_process";
import { promisify } from "node:util";

/** @impl TAR-2.2 @impl TAR-4.4 @impl TAR-7.3 */

const execFileAsync = promisify(execFile);

/**
 * 音源長は ffprobe のデコード長を正とする（design「Unity Timeline API マッピング表」）。
 *
 * Unity の `AudioClip.length` は非可逆フォーマットでエンコーダの遅延・パディングを
 * 含む（スパイク Q-5 実測: 2.0 s の MP3 が 2.0637 s と報告される）。この値は
 * 非ループクリップの終端クランプに使われるため、実長より短く報告されると
 * `atrim=end` が実音源の手前で切れて音が失われる。ffprobe の値で上書きすることで
 * この経路を塞ぐ。
 */
export interface SourceDurationResolver {
	resolveDurations(
		ffprobePath: string,
		sourcePaths: readonly string[],
	): Promise<SourceDurationResult>;
}

export interface SourceDurationResult {
	/** 解決できた音源のみ。キーは入力の絶対パス。 */
	readonly durations: ReadonlyMap<string, number>;
	/** 解決できなかった音源のパスと理由。呼び出し側は metadata の値へ degrade する。 */
	readonly unresolved: readonly {
		readonly sourcePath: string;
		readonly reason: string;
	}[];
}

function parseDuration(stdout: string): number | undefined {
	const value = Number.parseFloat(stdout.trim());
	return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * 同じ音源を複数のクリップが共有するのが普通なので、パス単位で 1 回だけ問い合わせる。
 */
export async function resolveSourceDurations(
	ffprobePath: string,
	sourcePaths: readonly string[],
): Promise<SourceDurationResult> {
	const durations = new Map<string, number>();
	const unresolved: { sourcePath: string; reason: string }[] = [];
	const unique = [...new Set(sourcePaths)];

	await Promise.all(
		unique.map(async (sourcePath) => {
			try {
				const { stdout } = await execFileAsync(
					ffprobePath,
					[
						"-v",
						"error",
						"-show_entries",
						"format=duration",
						"-of",
						"csv=p=0",
						sourcePath,
					],
					{ windowsHide: true },
				);
				const duration = parseDuration(stdout);
				if (duration === undefined) {
					unresolved.push({
						sourcePath,
						reason: `ffprobe returned no usable duration: ${stdout.trim() || "(empty)"}`,
					});
					return;
				}
				durations.set(sourcePath, duration);
			} catch (cause) {
				unresolved.push({
					sourcePath,
					reason: cause instanceof Error ? cause.message : String(cause),
				});
			}
		}),
	);

	return { durations, unresolved };
}

export const sourceDurationResolver: SourceDurationResolver = {
	resolveDurations: resolveSourceDurations,
};
