/** @impl URC-3.1 @impl URC-2.3 */

/**
 * Recorder 出力ファイル名で使えるワイルドカード。設定スキーマ(preflight)と
 * 出力計画の双方がこの一覧を参照するため、未知ワイルドカードは Editor 起動前に
 * 弾ける。config → batch の依存を作らないよう shared に置く。
 */
export const OUTPUT_WILDCARDS = [
	"Scene",
	"Take",
	"Recorder",
	"Resolution",
	"Frame Rate",
	"Date",
	"Time",
	"Project",
] as const;

export type OutputWildcard = (typeof OUTPUT_WILDCARDS)[number];

export function outputWildcardNames(fileName: string): string[] {
	const names: string[] = [];
	for (const match of fileName.matchAll(/<([^>]+)>/gu))
		names.push(match[1] ?? "");
	return names;
}

export function unknownOutputWildcards(fileName: string): string[] {
	return outputWildcardNames(fileName).filter(
		(name) => !(OUTPUT_WILDCARDS as readonly string[]).includes(name),
	);
}

export function outputWildcardListText(): string {
	return OUTPUT_WILDCARDS.map((value) => `<${value}>`).join(", ");
}

export function assertOutputWildcards(fileName: string): void {
	const unknown = unknownOutputWildcards(fileName);
	if (unknown.length > 0)
		throw new Error(
			`Unknown output wildcard <${unknown[0]}>; supported wildcards: ${outputWildcardListText()}`,
		);
}
