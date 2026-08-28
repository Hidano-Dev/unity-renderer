import { randomUUID } from "node:crypto";
import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../shared/types.js";
import type { GuardError } from "./backup.js";
export interface AddedPackage {
	readonly name: string;
	readonly version: string;
}
export const PINNED_PACKAGES = {
	"com.unity.recorder": "5.1.0",
	"com.unity.pipeline": "0.5.0-exp.1",
} as const;
/**
 * BOM 付き UTF-8 の manifest を受け付ける。Unity 自身は BOM を付けないが、
 * PowerShell 5.1 の `Set-Content -Encoding UTF8` などで書き換えると付く。
 * `JSON.parse` は先頭の U+FEFF を受け付けないため、落としてから解析する
 * （`src/audio-remux/metadata/load.ts` も同じ扱いをしている）。
 */
function stripBom(source: string): string {
	// 見えない文字はソースに直接置かず、必ずエスケープで書く
	return source.replace(/^\uFEFF/u, "");
}

/**
 * 失敗の理由を握り潰さない。`Temporary package addition failed.` だけでは、
 * BOM でも権限不足でもファイル欠落でも同じ 1 行しか出ず、利用者は原因を追えない。
 */
function causeDetail(cause: unknown): string {
	if (cause instanceof Error && cause.message.length > 0) return cause.message;
	const text = String(cause);
	return text.length > 0 ? text : "unknown error";
}

async function atomicWrite(filePath: string, content: string): Promise<void> {
	const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
	try {
		await writeFile(temporaryPath, content, "utf8");
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}
}
export async function patchManifest(
	projectPath: string,
): Promise<Result<readonly AddedPackage[], GuardError>> {
	const manifestPath = path.join(projectPath, "Packages", "manifest.json");
	try {
		const source = stripBom(await readFile(manifestPath, "utf8"));
		const manifest = JSON.parse(source) as {
			dependencies?: Record<string, string>;
		};
		if (
			manifest.dependencies === undefined ||
			typeof manifest.dependencies !== "object"
		)
			throw new Error("manifest dependencies must be an object");
		const added: AddedPackage[] = [];
		if (!("com.unity.recorder" in manifest.dependencies)) {
			manifest.dependencies["com.unity.recorder"] =
				PINNED_PACKAGES["com.unity.recorder"];
			added.push({
				name: "com.unity.recorder",
				version: PINNED_PACKAGES["com.unity.recorder"],
			});
		}
		if (!("com.unity.pipeline" in manifest.dependencies)) {
			manifest.dependencies["com.unity.pipeline"] =
				PINNED_PACKAGES["com.unity.pipeline"];
			added.push({
				name: "com.unity.pipeline",
				version: PINNED_PACKAGES["com.unity.pipeline"],
			});
		}
		if (added.length > 0)
			await atomicWrite(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
		return ok(added);
	} catch (cause) {
		return err({
			kind: "manifest-patch-failed",
			message: `Temporary package addition failed: ${causeDetail(cause)} (${manifestPath})`,
			cause,
		});
	}
}
