import { mkdir, readdir, stat, unlink } from "node:fs/promises";
import { extname, join, resolve } from "node:path";
import type { OutputFormat } from "../config/schema.js";

/** @impl URC-3.1 @impl URC-3.2 @impl URC-10.3 @impl URC-10.7 */

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
	readonly path: string;
}

const extensions: Record<OutputFormat, string> = {
	mp4: ".mp4",
	"mov-prores": ".mov",
};

function wildcardNames(fileName: string): string[] {
	const names: string[] = [];
	for (const match of fileName.matchAll(/<([^>]+)>/gu))
		names.push(match[1] ?? "");
	return names;
}

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

function assertWildcards(fileName: string): void {
	for (const name of wildcardNames(fileName)) {
		if (!(OUTPUT_WILDCARDS as readonly string[]).includes(name)) {
			throw new Error(
				`Unknown output wildcard <${name}>; supported wildcards: ${OUTPUT_WILDCARDS.map((value) => `<${value}>`).join(", ")}`,
			);
		}
	}
}

export function expandOutputFileName(
	fileName: string,
	context: OutputWildcardContext,
): string {
	assertWildcards(fileName);
	return fileName.replace(/<([^>]+)>/gu, (_, name: OutputWildcard) =>
		valueForWildcard(name, context),
	);
}

function outputPath(
	directory: string,
	fileName: string,
	format: OutputFormat,
): string {
	// Recorder の OutputFile は拡張子を除去したうえでコンテナ拡張子を自動付与する。
	// 計画パスと実出力パスを一致させるため、.mp4/.mov 以外の「拡張子風」の末尾
	// (例: v1.2, clip.avi) は名前の一部として保持し、常にフォーマット拡張子を付ける
	const extension = extname(fileName);
	const stem =
		extension && [".mp4", ".mov"].includes(extension.toLowerCase())
			? fileName.slice(0, -extension.length)
			: fileName;
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
		fileNameTemplate.replace("<Take>", marker),
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
		if (match) maximum = Math.max(maximum, Number(match[1]));
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
	const planned = input.formats.map((format) => ({
		format,
		path: outputPath(
			input.directory,
			expandOutputFileName(input.fileName, context),
			format,
		),
	}));
	const paths = new Set<string>();
	for (const output of planned) {
		if (paths.has(output.path.toLowerCase()))
			throw new Error(`Output filename collision: ${output.path}`);
		paths.add(output.path.toLowerCase());
	}
	return planned;
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
