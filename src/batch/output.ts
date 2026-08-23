import { randomUUID } from "node:crypto";
import { mkdir, readdir, rename, rm, stat, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { OutputFormat } from "../config/schema.js";
import {
	assertOutputWildcards,
	OUTPUT_WILDCARDS,
	type OutputWildcard,
	outputWildcardNames,
} from "../shared/output-wildcards.js";
import { writePromotionJournal } from "../shared/promotion-journal.js";

/** @impl URC-3.1 @impl URC-3.2 @impl URC-10.3 @impl URC-10.7 */

export { OUTPUT_WILDCARDS, type OutputWildcard };

/**
 * Recorder が書き込む一時ファイルの目印。録画は必ずこの staging パスへ行い、
 * 出力検証に成功したときだけ最終パスへ置換する。これにより、固定ファイル名で
 * 既存の正常な動画があっても、失敗した録画がそれを truncate・部分上書き
 * することがない(cleanup 対象は常に staging のみ)。
 */
const STAGING_SUFFIX = ".urc-partial";

export interface OutputWildcardContext {
	readonly project: string;
	readonly scene: string;
	readonly take?: number;
	readonly recorder?: string;
	readonly resolution?: { readonly width: number; readonly height: number };
	readonly frameRate?: number;
	readonly date?: string;
	readonly time?: string;
}

export interface OutputPlanInput {
	readonly directory: string;
	readonly fileName: string;
	readonly formats: readonly OutputFormat[];
	readonly context: OutputWildcardContext;
}

export interface PlannedOutput {
	readonly format: OutputFormat;
	/** 成功時に公開される最終パス */
	readonly path: string;
	/** Recorder が実際に書き込むパス。成功時のみ path へ置換される */
	readonly stagingPath: string;
}

const extensions: Record<OutputFormat, string> = {
	mp4: ".mp4",
	"mov-prores": ".mov",
};

const wildcardNames = outputWildcardNames;

function valueForWildcard(
	name: OutputWildcard,
	context: OutputWildcardContext,
): string {
	switch (name) {
		case "Scene":
			return context.scene;
		case "Take":
			return String(context.take ?? 1);
		case "Recorder":
			return context.recorder ?? "Movie";
		case "Resolution":
			return context.resolution
				? `${context.resolution.width}x${context.resolution.height}`
				: "";
		case "Frame Rate":
			return context.frameRate === undefined ? "" : String(context.frameRate);
		case "Date":
			return context.date ?? formatDate(new Date());
		case "Time":
			return context.time ?? formatTime(new Date());
		case "Project":
			return context.project;
	}
}

function formatDate(date: Date): string {
	return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}`;
}

function formatTime(date: Date): string {
	return `${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}${String(date.getSeconds()).padStart(2, "0")}`;
}

const assertWildcards = assertOutputWildcards;

export function expandOutputFileName(
	fileName: string,
	context: OutputWildcardContext,
): string {
	assertWildcards(fileName);
	return fileName.replace(/<([^>]+)>/gu, (_, name: OutputWildcard) =>
		valueForWildcard(name, context),
	);
}

function outputStem(fileName: string): string {
	// Recorder の OutputFile は拡張子を除去したうえでコンテナ拡張子を自動付与する。
	// 計画パスと実出力パスを一致させるため、.mp4/.mov 以外の「拡張子風」の末尾
	// (例: v1.2, clip.avi) は名前の一部として保持し、常にフォーマット拡張子を付ける
	const extension = extname(fileName);
	return extension && [".mp4", ".mov"].includes(extension.toLowerCase())
		? fileName.slice(0, -extension.length)
		: fileName;
}

function outputPath(
	directory: string,
	fileName: string,
	format: OutputFormat,
	staging = false,
): string {
	const stem = `${outputStem(fileName)}${staging ? STAGING_SUFFIX : ""}`;
	return join(resolve(directory), `${stem}${extensions[format]}`);
}

async function nextTake(input: OutputPlanInput): Promise<number> {
	if (!wildcardNames(input.fileName).includes("Take"))
		return input.context.take ?? 1;
	let files: readonly string[];
	try {
		files = await readdir(resolve(input.directory));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return 1;
		throw error;
	}
	const marker = "__TAKE__";
	const configuredExtension = extname(input.fileName).toLowerCase();
	const fileNameTemplate = [".mp4", ".mov"].includes(configuredExtension)
		? input.fileName.slice(0, -configuredExtension.length)
		: input.fileName;
	const pattern = expandOutputFileName(
		fileNameTemplate.replaceAll("<Take>", marker),
		{ ...input.context, take: 1 },
	);
	const escaped = pattern
		.split(marker)
		.map((part) => part.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"))
		.join("(\\d+)");
	const matcher = new RegExp(`^${escaped}(?:\\.[^.]+)?$`, "u");
	let maximum = 0;
	for (const file of files) {
		const match = matcher.exec(file);
		if (match)
			maximum = Math.max(
				maximum,
				...match.slice(1).map((take) => Number(take)),
			);
	}
	return maximum + 1;
}

export async function planOutputs(
	input: OutputPlanInput,
): Promise<PlannedOutput[]> {
	assertWildcards(input.fileName);
	if (input.formats.length === 0)
		throw new Error("At least one output format is required");
	await mkdir(resolve(input.directory), { recursive: true });
	const take = await nextTake(input);
	const context = { ...input.context, take };
	const expanded = expandOutputFileName(input.fileName, context);
	const planned = input.formats.map((format) => ({
		format,
		path: outputPath(input.directory, expanded, format),
		stagingPath: outputPath(input.directory, expanded, format, true),
	}));
	const paths = new Set<string>();
	for (const output of planned) {
		if (paths.has(output.path.toLowerCase()))
			throw new Error(`Output filename collision: ${output.path}`);
		paths.add(output.path.toLowerCase());
	}
	return planned;
}

/**
 * 検証済みの staging ファイルを最終パスへ公開する。ここで初めて既存の同名出力が
 * 置き換わるため、失敗した録画が既存物を壊すことはない。
 *
 * 公開はセット単位で全か無かにする。MP4 と MOV を出す構成で 2 件目の rename が
 * 失敗した場合、1 件目だけが置き換わるとフォーマット間で世代が混ざり、以前の
 * 正常な動画も失われる。そのため既存出力を退避してから置換し、途中で失敗したら
 * 置換済みを staging へ戻し、退避した既存出力を復帰させる。
 */
export interface PromoteOptions {
	/**
	 * 退避情報を記録するジャーナルのパス。プロセスや OS が公開の途中で落ちても、
	 * 次回起動の復旧がここから旧出力を戻せるようにする。
	 */
	readonly journalPath?: string;
}

export async function promoteOutputFiles(
	outputs: readonly PlannedOutput[],
	options: PromoteOptions = {},
): Promise<void> {
	// 退避「予定」を rename より先に記録する。記録前に落ちれば退避もされておらず、
	// 記録後に落ちた場合は復旧が退避先を辿れる。退避が実行されなかった予定は
	// 復旧時に退避先が存在しないため無視される
	const planned: { readonly path: string; readonly backup: string }[] = [];
	const displaced: { readonly path: string; readonly backup: string }[] = [];
	const promoted: PlannedOutput[] = [];
	try {
		for (const output of outputs) {
			const backup = `${output.path}.${randomUUID()}.previous`;
			planned.push({ path: output.path, backup });
			if (options.journalPath)
				await writePromotionJournal(options.journalPath, {
					displaced: planned,
				});
			try {
				await rename(output.path, backup);
				displaced.push({ path: output.path, backup });
			} catch (error) {
				// 既存出力が無いのが通常。それ以外の失敗は公開を中止する
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
			await rename(output.stagingPath, output.path);
			promoted.push(output);
		}
	} catch (cause) {
		// 補償処理の失敗を握り潰すと、旧動画の欠落や形式間の世代混在が
		// 通常の公開失敗と区別できなくなる。残存物を添えて報告する
		const unresolved: string[] = [];
		for (const output of promoted)
			await rename(output.path, output.stagingPath).catch(() =>
				unresolved.push(`公開済みを staging へ戻せません: ${output.path}`),
			);
		for (const { path, backup } of displaced)
			await rename(backup, path).catch(() =>
				unresolved.push(`退避した旧出力を戻せません: ${backup} → ${path}`),
			);
		if (unresolved.length > 0)
			throw new Error(
				`出力の公開に失敗し、巻き戻しも完了しませんでした: ${cause instanceof Error ? cause.message : String(cause)}\n手動復旧が必要です:\n- ${unresolved.join("\n- ")}`,
				{ cause },
			);
		if (options.journalPath) await rm(options.journalPath, { force: true });
		throw cause;
	}
	for (const { backup } of displaced) await rm(backup, { force: true });
	if (options.journalPath) await rm(options.journalPath, { force: true });
}

export async function validateOutputFiles(
	paths: readonly string[],
): Promise<readonly string[]> {
	for (const path of paths) {
		try {
			if ((await stat(path)).size <= 0) throw new Error("empty");
		} catch {
			throw new Error(`Output file missing or empty: ${path}`);
		}
	}
	return paths;
}

export async function cleanupOutputFiles(
	paths: readonly string[],
	debug: boolean,
): Promise<void> {
	if (debug) return;
	await Promise.all(
		paths.map(async (path) => {
			try {
				await unlink(path);
			} catch (error) {
				if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
			}
		}),
	);
}
