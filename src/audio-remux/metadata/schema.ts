import { z } from "zod";
import { err, ok, type Result } from "../../shared/types.js";

/** @impl TAR-2.1 @impl TAR-3.1 @impl TAR-3.2 @impl TAR-3.3 @impl TAR-10.1 */

const nonEmptyString = z.string().trim().min(1);
const finiteNumber = z.number().finite();

const extractionEntryErrorSchema = z
	.object({
		kind: z.enum(["sub-asset-source", "asset-path-unresolved", "unexpected"]),
		clipId: nonEmptyString,
		detail: nonEmptyString,
	})
	.strict();

const extractionWarningSchema = z
	.object({
		kind: z.enum([
			"control-clip-unresolved",
			"invalid-time-value",
			"audio-clip-missing",
			"clip-in-clamped",
		]),
		clipId: nonEmptyString,
		detail: nonEmptyString,
	})
	.strict();

const audioClipEntrySchema = z
	.object({
		id: nonEmptyString,
		trackPath: nonEmptyString,
		sourcePath: nonEmptyString,
		sourceSampleRate: finiteNumber.int().positive().optional(),
		sourceDurationSec: finiteNumber.positive(),
		rootStartSec: finiteNumber.nonnegative(),
		rootEndSec: finiteNumber,
		clipInSec: finiteNumber.nonnegative(),
		effectiveSpeed: finiteNumber.positive(),
		clipVolume: finiteNumber.min(0).max(1),
		trackVolume: finiteNumber.min(0).max(1),
		trackMuted: z.boolean(),
		loop: z.boolean(),
	})
	.strict()
	.refine((clip) => clip.rootEndSec > clip.rootStartSec, {
		path: ["rootEndSec"],
		message: "must be greater than rootStartSec",
	});

export const audioTimelineMetadataSchema = z
	.object({
		schemaVersion: z.literal(1),
		sceneName: nonEmptyString,
		extractedAt: z
			.string()
			.datetime({ offset: true })
			.refine(
				(value) => value.endsWith("Z"),
				"must be an ISO 8601 UTC timestamp",
			),
		clips: z.array(audioClipEntrySchema),
		errors: z.array(extractionEntryErrorSchema),
		warnings: z.array(extractionWarningSchema),
	})
	.strict();

export type AudioTimelineMetadata = z.infer<typeof audioTimelineMetadataSchema>;
export type AudioClipEntry = AudioTimelineMetadata["clips"][number];
export type ExtractionEntryError = AudioTimelineMetadata["errors"][number];
export type ExtractionWarning = AudioTimelineMetadata["warnings"][number];

export interface MetadataValidationIssue {
	readonly path: string;
	readonly message: string;
}

export interface MetadataValidationError {
	readonly kind: "validation-error";
	readonly issues: readonly MetadataValidationIssue[];
}

function issuePath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : path.map(String).join(".");
}

export function metadataValidationErrorFromZodError(
	error: z.ZodError,
): MetadataValidationError {
	return {
		kind: "validation-error",
		issues: error.issues.map((issue) => ({
			path: issuePath(issue.path),
			message: issue.message,
		})),
	};
}

export function validateAudioTimelineMetadata(
	input: unknown,
): Result<AudioTimelineMetadata, MetadataValidationError> {
	const result = audioTimelineMetadataSchema.safeParse(input);
	return result.success
		? ok(result.data)
		: err(metadataValidationErrorFromZodError(result.error));
}
