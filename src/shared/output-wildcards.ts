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

/** 認識済みワイルドカードを展開後の代表値へ置き換えた、検証用の文字列。 */
function withoutWildcards(fileName: string): string {
	return fileName.replace(/<([^>]+)>/gu, (match, name: string) =>
		(OUTPUT_WILDCARDS as readonly string[]).includes(name) ? "x" : match,
	);
}

const WINDOWS_RESERVED_NAMES =
	/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/iu;
const WINDOWS_FORBIDDEN_CHARACTERS = /[<>:"/\\|?*]/u;

/** 制御文字はファイル名に使えない。正規表現へ埋め込まずに走査する。 */
function controlCharacterIn(value: string): string | undefined {
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || code === 0x7f) return character;
	}
	return undefined;
}

/**
 * Windows で作成できないファイル名を preflight で弾く。Editor 起動と manifest の
 * 一時変更を経てから Recorder / ファイル操作で失敗するのを避けるため、`check` の
 * 時点で項目付きエラーにする。認識済みワイルドカードの `<>` は検査対象から外す。
 */
export function invalidWindowsFileNameReason(
	fileName: string,
): string | undefined {
	const candidate = withoutWildcards(fileName);
	const forbidden = candidate.match(WINDOWS_FORBIDDEN_CHARACTERS);
	if (forbidden)
		return `must not contain the Windows-reserved character ${JSON.stringify(forbidden[0])}`;
	if (controlCharacterIn(candidate))
		return "must not contain control characters";
	if (/[ .]$/u.test(candidate))
		return "must not end with a space or a dot on Windows";
	if (WINDOWS_RESERVED_NAMES.test(candidate))
		return "must not use a Windows reserved device name (CON, PRN, AUX, NUL, COM1-9, LPT1-9)";
	return undefined;
}

export function assertOutputWildcards(fileName: string): void {
	const unknown = unknownOutputWildcards(fileName);
	if (unknown.length > 0)
		throw new Error(
			`Unknown output wildcard <${unknown[0]}>; supported wildcards: ${outputWildcardListText()}`,
		);
}
