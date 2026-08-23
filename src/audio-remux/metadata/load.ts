import { constants } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { err, ok, type Result } from "../../shared/types.js";
import {
	type AudioTimelineMetadata,
	type MetadataValidationIssue,
	validateAudioTimelineMetadata,
} from "./schema.js";

/** @impl TAR-2.1 @impl TAR-3.2 @impl TAR-3.3 @impl TAR-10.1 */

export const AUDIO_METADATA_FILE_NAME = "timeline-audio-metadata.json";

export type MetadataLoadError =
	| {
			readonly kind: "not-found";
			readonly issues: readonly MetadataValidationIssue[];
	  }
	| {
			readonly kind: "parse-error";
			readonly issues: readonly MetadataValidationIssue[];
	  }
	| {
			readonly kind: "validation-error";
			readonly issues: readonly MetadataValidationIssue[];
	  }
	| {
			readonly kind: "extraction-errors";
			readonly issues: readonly MetadataValidationIssue[];
	  }
	| {
			readonly kind: "source-missing";
			readonly issues: readonly MetadataValidationIssue[];
	  };

function issue(path: string, message: string): MetadataValidationIssue {
	return { path, message };
}

function metadataPath(sessionDir: string, fileName: string): string {
	return join(sessionDir, fileName);
}

async function sourceExists(sourcePath: string): Promise<boolean> {
	try {
		await access(sourcePath, constants.R_OK);
		return true;
	} catch {
		return false;
	}
}

export async function loadAudioTimelineMetadata(
	sessionDir: string,
	fileName = AUDIO_METADATA_FILE_NAME,
): Promise<Result<AudioTimelineMetadata, MetadataLoadError>> {
	const filePath = metadataPath(sessionDir, fileName);
	let contents: string;
	try {
		contents = await readFile(filePath, "utf8");
	} catch (cause) {
		const code = (cause as NodeJS.ErrnoException).code;
		return err({
			kind: code === "ENOENT" ? "not-found" : "parse-error",
			issues: [issue("$", `metadata file could not be read: ${filePath}`)],
		});
	}

	let input: unknown;
	try {
		input = JSON.parse(contents.replace(/^\uFEFF/u, "")) as unknown;
	} catch (cause) {
		return err({
			kind: "parse-error",
			issues: [
				issue("$", cause instanceof Error ? cause.message : "invalid JSON"),
			],
		});
	}

	const validated = validateAudioTimelineMetadata(input);
	if (!validated.ok) return err(validated.error);

	if (validated.value.errors.length > 0) {
		// Carry each reported error through with its clip id and detail. A single
		// generic issue here leaves the user with no way to tell which clip or
		// source file was at fault (10.1).
		return err({
			kind: "extraction-errors",
			issues: validated.value.errors.map((entry, index) =>
				issue(
					`errors[${index}]`,
					`${entry.kind}: ${entry.detail} (clip ${entry.clipId})`,
				),
			),
		});
	}

	const missingIssues: MetadataValidationIssue[] = [];
	await Promise.all(
		validated.value.clips.map(async (clip, index) => {
			if (!(await sourceExists(clip.sourcePath))) {
				missingIssues.push(
					issue(
						`clips[${index}].sourcePath`,
						`audio source file does not exist or is not readable: ${clip.sourcePath} (clip ${clip.id})`,
					),
				);
			}
		}),
	);
	missingIssues.sort((left, right) => left.path.localeCompare(right.path));
	if (missingIssues.length > 0)
		return err({ kind: "source-missing", issues: missingIssues });

	return ok(validated.value);
}
