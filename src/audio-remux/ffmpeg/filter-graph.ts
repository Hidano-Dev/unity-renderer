import type { MixPlan, PlacedClip } from "../planner/mix-plan.js";

export type PitchMode = "resample" | "preserve-pitch";

export interface FilterGraph {
	readonly script: string;
	readonly inputArgs: readonly string[];
	readonly mixLabel: "[mix]";
}

function number(value: number): string {
	return value.toString();
}

function clipChain(clip: PlacedClip, pitchMode: PitchMode): string {
	const steps = [
		`atrim=start=${number(clip.sourceTrimStartSec)}:end=${number(clip.sourceTrimEndSec)}`,
		"asetpts=N/SR/TB",
	];

	if (clip.speed !== 1) {
		if (pitchMode === "resample") {
			const sourceRate = clip.sourceSampleRate ?? 48000;
			steps.push(`asetrate=${Math.round(sourceRate * clip.speed)}`);
		} else {
			steps.push(`atempo=${number(clip.speed)}`);
		}
	}

	steps.push(
		"aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo",
	);
	if (clip.gain !== 1) steps.push(`volume=${number(clip.gain)}`);
	if (clip.delaySamples > 0) steps.push(`adelay=${clip.delaySamples}S:all=1`);

	return `[${clip.inputIndex}:a]${steps.join(",")}[a${clip.inputIndex}]`;
}

export function buildFilterGraph(
	plan: MixPlan,
	pitchMode: PitchMode = "resample",
): FilterGraph {
	const inputArgs: string[] = [];
	const chains: string[] = [];
	const labels: string[] = [];

	for (const clip of plan.clips) {
		if (clip.loop) inputArgs.push("-stream_loop", "-1");
		inputArgs.push("-i", clip.sourcePath);
		chains.push(clipChain(clip, pitchMode));
		labels.push(`[a${clip.inputIndex}]`);
	}

	const totalSamples = Math.round(plan.outputDurationSec * plan.sampleRate);
	if (labels.length === 0) {
		chains.push(
			`anullsrc=channel_layout=stereo:sample_rate=${plan.sampleRate},apad,atrim=end_sample=${totalSamples},asetpts=N/SR/TB[mix]`,
		);
	} else {
		chains.push(
			`${labels.join("")}amix=inputs=${labels.length}:normalize=0:duration=longest[mixed]`,
		);
		chains.push(
			`[mixed]apad,atrim=end_sample=${totalSamples},asetpts=N/SR/TB[mix]`,
		);
	}

	return { script: chains.join(";"), inputArgs, mixLabel: "[mix]" };
}
