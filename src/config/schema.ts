import { z } from "zod";
import {
	invalidWindowsFileNameReason,
	outputWildcardListText,
	unknownOutputWildcards,
} from "../shared/output-wildcards.js";
import { err, ok, type Result } from "../shared/types.js";

/** @impl URC-2.1 @impl URC-2.3 @impl URC-2.4 @impl URC-2.5 */

const nonEmptyString = z.string().trim().min(1, "must not be empty");
const positiveNumber = z.number().finite().positive();
const positiveInteger = z.number().int().positive();

/**
 * Recorder と C# 側が扱える解像度の上限。Editor 起動後の OverflowException や
 * テクスチャ確保失敗ではなく、preflight で報告するために設ける。
 */
const MAX_RESOLUTION_PIXELS = 16_384;
/** C# 側 (Int32) が扱える録画フレーム数の上限。 */
export const MAX_RECORDED_FRAMES = 2_147_483_647;
const resolutionAxis = positiveInteger.max(
	MAX_RESOLUTION_PIXELS,
	`must not exceed ${MAX_RESOLUTION_PIXELS} pixels (Recorder and GPU limit)`,
);

const rangeSchema = z
	.object({
		inPoint: z.number().finite().nonnegative(),
		outPoint: z.number().finite().positive(),
	})
	.strict()
	.refine(({ inPoint, outPoint }) => outPoint > inPoint, {
		path: ["outPoint"],
		message: "must be greater than inPoint",
	});

const outputSchema = z
	.object({
		directory: nonEmptyString,
		fileName: nonEmptyString
			.refine(
				(value) => !/[\\/]/u.test(value),
				"must be a file name, not a path",
			)
			.refine((value) => !value.endsWith("."), "must not end with a dot")
			// Editor 起動前に未知ワイルドカードを弾く(起動後の planOutputs 失敗だと
			// manifest を一時変更した後になるため、check では検出できない)
			.superRefine((value, context) => {
				const unknown = unknownOutputWildcards(value);
				if (unknown.length > 0) {
					context.addIssue({
						code: "custom",
						message: `unknown wildcard <${unknown[0]}>; supported wildcards: ${outputWildcardListText()}`,
					});
					return;
				}
				// Windows で作成できない名前も Editor 起動前に弾く
				const invalid = invalidWindowsFileNameReason(value);
				if (invalid) context.addIssue({ code: "custom", message: invalid });
			}),
	})
	.strict();

const timeoutsSchema = z
	.object({
		recordingSec: positiveNumber.optional(),
		editorStartSec: positiveNumber.optional(),
		editorQuitSec: positiveNumber.optional(),
	})
	.strict();

export const renderConfigSchema = z
	.object({
		projectPath: nonEmptyString,
		scenes: z
			.array(nonEmptyString)
			.min(1, "must contain at least one scene")
			.refine(
				(scenes) => new Set(scenes).size === scenes.length,
				"must not contain duplicates",
			)
			.refine(
				(scenes) => scenes.every((scene) => !/[\\/]/u.test(scene)),
				"must contain scene names, not paths",
			),
		range: rangeSchema.optional(),
		resolution: z
			.object({
				width: resolutionAxis,
				height: resolutionAxis,
			})
			.strict(),
		// 上限は Recorder の実用域。録画フレーム数が Int32 を溢れないようにも効く
		frameRate: positiveNumber.max(
			1_000,
			"must not exceed 1000 (Recorder practical limit)",
		),
		formats: z
			.array(z.enum(["mp4", "mov-prores"]))
			.min(1, "must contain at least one format")
			.max(2, "must contain at most two formats")
			.refine(
				(formats) => new Set(formats).size === formats.length,
				"must not contain duplicates",
			),
		output: outputSchema,
		debug: z.boolean().optional(),
		timeouts: timeoutsSchema.optional(),
	})
	.strict()
	.superRefine((config, context) => {
		// 録画フレーム数は C# 側で Int32 に載る。range 指定時は preflight で検証し、
		// Editor 起動後の変換失敗や 1 フレームだけの誤出力を防ぐ
		if (!config.range) return;
		const frames =
			(config.range.outPoint - config.range.inPoint) * config.frameRate;
		if (frames > MAX_RECORDED_FRAMES)
			context.addIssue({
				code: "custom",
				path: ["range", "outPoint"],
				message: `recorded frame count ((outPoint - inPoint) * frameRate) must not exceed ${MAX_RECORDED_FRAMES}`,
			});
	});

export type RenderConfig = z.infer<typeof renderConfigSchema>;
export type OutputFormat = RenderConfig["formats"][number];

export interface ConfigError {
	readonly kind: "not-found" | "parse-error" | "validation-error";
	readonly issues: readonly {
		readonly path: string;
		readonly message: string;
	}[];
}

function issuePath(path: readonly PropertyKey[]): string {
	return path.length === 0 ? "$" : path.map(String).join(".");
}

export function configErrorFromZodError(error: z.ZodError): ConfigError {
	return {
		kind: "validation-error",
		issues: error.issues.map((issue) => ({
			path: issuePath(issue.path),
			message: issue.message,
		})),
	};
}

export function validateRenderConfig(
	input: unknown,
): Result<RenderConfig, ConfigError> {
	const result = renderConfigSchema.safeParse(input);
	return result.success
		? ok(result.data)
		: err(configErrorFromZodError(result.error));
}
