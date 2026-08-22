import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../shared/types.js";
import type { EnvError } from "./unity-cli.js";

export interface UnityVersion {
	readonly raw: string;
	readonly major: number;
}
const versionPattern = /^(\d{4,5})\.\d+\.\d+(?:[abfp]\d+)$/i;

export function parseProjectVersion(
	contents: string,
): Result<UnityVersion, EnvError> {
	const raw = contents.match(/^\s*m_EditorVersion:\s*([^\s]+)\s*$/m)?.[1];
	if (!raw || !versionPattern.test(raw))
		return err({
			kind: "project-version-unreadable",
			message:
				"ProjectSettings/ProjectVersion.txt の m_EditorVersion を解析できませんでした",
		});
	return ok({ raw, major: Number(raw.split(".")[0]) });
}

export function isSupportedUnityVersion(version: UnityVersion): boolean {
	return version.major >= 6000;
}

export async function readProjectVersion(
	projectPath: string,
): Promise<Result<UnityVersion, EnvError>> {
	try {
		const result = parseProjectVersion(
			await readFile(
				join(projectPath, "ProjectSettings", "ProjectVersion.txt"),
				"utf8",
			),
		);
		if (!result.ok) return result;
		return isSupportedUnityVersion(result.value)
			? result
			: err({
					kind: "unsupported-unity-version",
					message: `Unity ${result.value.raw} は非対応です。Unity 6.0 以上を使用してください。`,
				});
	} catch (cause) {
		return err({
			kind: "project-version-unreadable",
			message: `ProjectVersion.txt を読み取れませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}
}
