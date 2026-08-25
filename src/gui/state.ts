import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import type { OutputFormat } from "../config/schema.js";
import { resolveToolDirectory } from "../shared/paths.js";
import { type CommonError, err, ok, type Result } from "../shared/types.js";

export const GUI_STATE_FILE_NAME = "gui-state.json";

const KNOWN_FORMATS: readonly OutputFormat[] = ["mp4", "mov-prores"];

const BOM_CODE_POINT = 0xfe_ff;

/** Windows のエディタ・PowerShell は BOM 付き UTF-8 を書くことがある。 */
function stripBom(value: string): string {
	return value.charCodeAt(0) === BOM_CODE_POINT ? value.slice(1) : value;
}

/**
 * GUI が覚えておく入力内容。render 設定 JSON とは別に保持する。
 *
 * 設定 JSON は `scenes` に最低 1 件を要求するスキーマなので、「すべて OFF」の
 * ような編集途中の状態を書き戻せない。GUI の記憶をそこへ相乗りさせると、
 * チェックを全部外した瞬間に CLI から読めない設定ファイルが残ってしまう。
 * そのため GUI 側の状態はこのファイルへ、実行用の設定はその都度 render 設定
 * JSON へ、と役割を分けている。
 */
export interface GuiState {
	readonly projectPath: string;
	readonly outputDirectory: string;
	readonly fileName: string;
	readonly selectedScenes: readonly string[];
	readonly resolution: {
		readonly width: number;
		readonly height: number;
	};
	readonly frameRate: number;
	readonly formats: readonly OutputFormat[];
}

export const defaultGuiState: GuiState = {
	projectPath: "",
	outputDirectory: "",
	fileName: "<Scene>_<Take>",
	selectedScenes: [],
	resolution: { width: 1920, height: 1080 },
	frameRate: 30,
	formats: ["mp4"],
};

export interface GuiStatePathOptions {
	readonly env?: NodeJS.ProcessEnv;
	/** テストと保存先の差し替え用。指定時は LOCALAPPDATA を参照しない。 */
	readonly stateFilePath?: string;
}

export function resolveGuiStatePath(
	options: GuiStatePathOptions = {},
): Result<string, CommonError> {
	if (options.stateFilePath !== undefined) return ok(options.stateFilePath);
	const toolDirectory = resolveToolDirectory({ env: options.env });
	if (!toolDirectory.ok) return toolDirectory;
	return ok(path.win32.join(toolDirectory.value, GUI_STATE_FILE_NAME));
}

function asString(value: unknown, fallback: string): string {
	return typeof value === "string" ? value : fallback;
}

function asPositiveNumber(value: unknown, fallback: number): number {
	return typeof value === "number" && Number.isFinite(value) && value > 0
		? value
		: fallback;
}

function asSceneNames(value: unknown): readonly string[] {
	if (!Array.isArray(value)) return defaultGuiState.selectedScenes;
	const names = value.filter(
		(entry): entry is string => typeof entry === "string" && entry.length > 0,
	);
	return [...new Set(names)];
}

function asFormats(value: unknown): readonly OutputFormat[] {
	if (!Array.isArray(value)) return defaultGuiState.formats;
	const formats = [
		...new Set(
			value.filter((entry): entry is OutputFormat =>
				KNOWN_FORMATS.includes(entry as OutputFormat),
			),
		),
	];
	// 空になった場合は既定へ戻す。0 件のまま実行させるとスキーマ検証で弾かれ、
	// 「フォーマットを 1 つ以上選べ」という当たり前の指摘のために往復が増える
	return formats.length > 0 ? formats : defaultGuiState.formats;
}

/**
 * 壊れた JSON・古い形・部分的な欠落をすべて既定値へ倒す。GUI の記憶は失っても
 * 実害が無い一方、ここで例外を出すと窓が一切開かなくなる。
 */
export function sanitizeGuiState(input: unknown): GuiState {
	if (typeof input !== "object" || input === null) return defaultGuiState;
	const record = input as Record<string, unknown>;
	const resolution =
		typeof record.resolution === "object" && record.resolution !== null
			? (record.resolution as Record<string, unknown>)
			: {};
	return {
		projectPath: asString(record.projectPath, defaultGuiState.projectPath),
		outputDirectory: asString(
			record.outputDirectory,
			defaultGuiState.outputDirectory,
		),
		fileName: asString(record.fileName, defaultGuiState.fileName),
		selectedScenes: asSceneNames(record.selectedScenes),
		resolution: {
			width: asPositiveNumber(
				resolution.width,
				defaultGuiState.resolution.width,
			),
			height: asPositiveNumber(
				resolution.height,
				defaultGuiState.resolution.height,
			),
		},
		frameRate: asPositiveNumber(record.frameRate, defaultGuiState.frameRate),
		formats: asFormats(record.formats),
	};
}

export async function loadGuiState(
	options: GuiStatePathOptions = {},
): Promise<GuiState> {
	const statePath = resolveGuiStatePath(options);
	if (!statePath.ok) return defaultGuiState;
	try {
		const contents = await readFile(statePath.value, "utf8");
		return sanitizeGuiState(JSON.parse(stripBom(contents)));
	} catch {
		return defaultGuiState;
	}
}

export async function saveGuiState(
	state: GuiState,
	options: GuiStatePathOptions = {},
): Promise<Result<string, CommonError>> {
	const statePath = resolveGuiStatePath(options);
	if (!statePath.ok) return statePath;
	try {
		await mkdir(path.dirname(statePath.value), { recursive: true });
		await writeFile(
			statePath.value,
			`${JSON.stringify(sanitizeGuiState(state), null, 2)}\n`,
			"utf8",
		);
		return ok(statePath.value);
	} catch (cause) {
		return err({
			category: "io",
			code: "gui-state-write-failed",
			message: `GUI の設定を保存できませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}
}
