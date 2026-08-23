import type { RenderHandoff } from "../../hooks/registry.js";
import type { AudioTimelineMetadata } from "../metadata/schema.js";
import { placeClip } from "./time-math.js";

/** @impl TAR-4.2 @impl TAR-4.3 @impl TAR-4.4 @impl TAR-4.5 @impl TAR-4.6 @impl TAR-7.1 */

export interface PlacedClip {
	readonly clipId: string;
	readonly inputIndex: number;
	readonly sourcePath: string;
	readonly loop: boolean;
	readonly sourceTrimStartSec: number;
	readonly sourceTrimEndSec: number;
	readonly speed: number;
	readonly gain: number;
	readonly delaySamples: number;
}

export interface SkippedClip {
	readonly clipId: string;
	readonly reason: string;
}

export interface MixPlan {
	readonly sampleRate: 48000;
	readonly channels: 2;
	readonly outputDurationSec: number;
	readonly clips: readonly PlacedClip[];
	readonly skipped: readonly SkippedClip[];
}

export interface MixPlanner {
	buildMixPlan(
		metadata: AudioTimelineMetadata,
		handoff: RenderHandoff,
	): MixPlan;
}

/** Build the deterministic, ffmpeg-independent placement plan for one render. */
export function buildMixPlan(
	metadata: AudioTimelineMetadata,
	handoff: RenderHandoff,
): MixPlan {
	const clips: PlacedClip[] = [];
	const skipped: SkippedClip[] = [];

	for (const clip of metadata.clips) {
		if (clip.trackMuted) {
			skipped.push({ clipId: clip.id, reason: "track-muted" });
			continue;
		}

		const placement = placeClip({
			clipId: clip.id,
			rootStartSec: clip.rootStartSec,
			rootEndSec: clip.rootEndSec,
			clipInSec: clip.clipInSec,
			sourceDurationSec: clip.sourceDurationSec,
			effectiveSpeed: clip.effectiveSpeed,
			loop: clip.loop,
			inPointSec: handoff.inPoint,
			outPointSec: handoff.outPoint,
		});

		if (placement.status === "skipped") {
			skipped.push({ clipId: clip.id, reason: placement.reason });
			continue;
		}

		clips.push({
			clipId: clip.id,
			inputIndex: clips.length,
			sourcePath: clip.sourcePath,
			loop: placement.loop,
			sourceTrimStartSec: placement.sourceTrimStartSec,
			sourceTrimEndSec: placement.sourceTrimEndSec,
			speed: placement.speed,
			gain: clip.clipVolume * clip.trackVolume,
			delaySamples: placement.delaySamples,
		});
	}

	return {
		sampleRate: 48000,
		channels: 2,
		outputDurationSec: handoff.outPoint - handoff.inPoint,
		clips,
		skipped,
	};
}

export const mixPlanner: MixPlanner = { buildMixPlan };
