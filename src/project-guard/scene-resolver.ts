import { readdir } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../shared/types.js";

/** @impl URC-5.1 @impl URC-5.2 @impl URC-5.3 @impl URC-5.4 */

export interface ResolvedScene {
	readonly sceneName: string;
	/** Path relative to the Unity project, always using `/` separators. */
	readonly assetPath: string;
}

export interface SceneResolutionDetail {
	readonly sceneName: string;
	readonly candidatePaths: readonly string[];
}

export interface SceneResolutionError {
	readonly kind: "scenes-missing" | "scenes-ambiguous";
	readonly details: readonly SceneResolutionDetail[];
}

interface SceneFile {
	readonly sceneName: string;
	readonly assetPath: string;
}

async function findSceneFiles(
	directory: string,
	projectPath: string,
): Promise<SceneFile[]> {
	const entries = await readdir(directory, { withFileTypes: true });
	const files: SceneFile[] = [];

	for (const entry of entries) {
		const absolutePath = path.join(directory, entry.name);
		if (entry.isDirectory()) {
			files.push(...(await findSceneFiles(absolutePath, projectPath)));
			continue;
		}
		if (!entry.isFile() || path.extname(entry.name) !== ".unity") continue;

		files.push({
			sceneName: path.basename(entry.name, ".unity"),
			assetPath: path
				.relative(projectPath, absolutePath)
				.split(path.sep)
				.join("/"),
		});
	}

	return files;
}

/** Resolve all configured Scene names in one Assets-tree scan. */
export async function resolveScenes(
	projectPath: string,
	names: readonly string[],
): Promise<Result<readonly ResolvedScene[], SceneResolutionError>> {
	const resolvedProjectPath = path.resolve(projectPath);
	const assetsPath = path.join(resolvedProjectPath, "Assets");
	let sceneFiles: SceneFile[];
	try {
		sceneFiles = await findSceneFiles(assetsPath, resolvedProjectPath);
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause;
		sceneFiles = [];
	}

	const missing: SceneResolutionDetail[] = [];
	const ambiguous: SceneResolutionDetail[] = [];
	const resolved: ResolvedScene[] = [];

	for (const sceneName of names) {
		const candidates = sceneFiles
			.filter((scene) => scene.sceneName === sceneName)
			.map((scene) => scene.assetPath)
			.sort();
		if (candidates.length === 0) {
			missing.push({ sceneName, candidatePaths: [] });
		} else if (candidates.length > 1) {
			ambiguous.push({ sceneName, candidatePaths: candidates });
		} else {
			resolved.push({ sceneName, assetPath: candidates[0] as string });
		}
	}

	if (missing.length > 0)
		return err({ kind: "scenes-missing", details: missing });
	if (ambiguous.length > 0)
		return err({ kind: "scenes-ambiguous", details: ambiguous });
	return ok(resolved);
}
