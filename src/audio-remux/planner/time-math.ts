/** @impl TAR-2.6 @impl TAR-7.1 @impl TAR-7.2 @impl TAR-7.3 @impl TAR-7.4 */

export interface ClipTimeInput {
	readonly clipId: string;
	readonly rootStartSec: number;
	readonly rootEndSec: number;
	readonly clipInSec: number;
	readonly sourceDurationSec: number;
	readonly effectiveSpeed: number;
	readonly loop: boolean;
	readonly inPointSec: number;
	readonly outPointSec: number;
}

export interface PlacedTimeClip {
	readonly status: "placed";
	readonly clipId: string;
	readonly sourceTrimStartSec: number;
	readonly sourceTrimEndSec: number;
	readonly speed: number;
	readonly loop: boolean;
	readonly outputStartSec: number;
	readonly outputDurationSec: number;
	readonly delaySec: number;
	readonly delaySamples: number;
	readonly warnings: readonly "clip-in-clamped"[];
}

export interface SkippedTimeClip {
	readonly status: "skipped";
	readonly reason:
		| "invalid-time-value"
		| "empty-interval"
		| "zero-source-duration";
	readonly warnings: readonly [];
}

export type ClipTimeResult = PlacedTimeClip | SkippedTimeClip;

function finitePositive(value: number): boolean {
	return Number.isFinite(value) && value > 0;
}

/** Convert one extracted clip into its ffmpeg-independent placement. */
export function placeClip(input: ClipTimeInput): ClipTimeResult {
	if (
		!finitePositive(input.effectiveSpeed) ||
		!Number.isFinite(input.rootStartSec) ||
		!Number.isFinite(input.rootEndSec) ||
		!Number.isFinite(input.clipInSec) ||
		!Number.isFinite(input.inPointSec) ||
		!Number.isFinite(input.outPointSec)
	) {
		return { status: "skipped", reason: "invalid-time-value", warnings: [] };
	}

	if (
		!Number.isFinite(input.sourceDurationSec) ||
		input.sourceDurationSec <= 0
	) {
		return { status: "skipped", reason: "zero-source-duration", warnings: [] };
	}

	const clipEnd = Math.min(input.rootEndSec, input.outPointSec);
	const clipStart = Math.max(input.rootStartSec, input.inPointSec);
	if (input.rootEndSec <= input.rootStartSec || clipEnd <= clipStart) {
		return { status: "skipped", reason: "empty-interval", warnings: [] };
	}

	const clipInSec = Math.max(0, input.clipInSec);
	const warnings: readonly "clip-in-clamped"[] =
		input.clipInSec < 0 ? ["clip-in-clamped"] : [];
	const elapsedFromClipStart = Math.max(0, clipStart - input.rootStartSec);
	const sourceTrimStartSec =
		clipInSec + elapsedFromClipStart * input.effectiveSpeed;
	const outputDurationSec = clipEnd - clipStart;
	const requestedSourceEnd =
		sourceTrimStartSec + outputDurationSec * input.effectiveSpeed;
	const sourceTrimEndSec = input.loop
		? requestedSourceEnd
		: Math.min(requestedSourceEnd, input.sourceDurationSec);
	if (!input.loop && sourceTrimStartSec >= input.sourceDurationSec) {
		return { status: "skipped", reason: "empty-interval", warnings: [] };
	}

	const delaySec = clipStart - input.inPointSec;
	const delaySamples = Math.max(0, Math.round(delaySec * 48000));
	return {
		status: "placed",
		clipId: input.clipId,
		sourceTrimStartSec,
		sourceTrimEndSec,
		speed: input.effectiveSpeed,
		loop: input.loop,
		outputStartSec: delaySec,
		outputDurationSec,
		delaySec,
		delaySamples,
		warnings,
	};
}

/** Semantic alias used by callers that refer to the operation as normalization. */
export const normalizeClip = placeClip;
