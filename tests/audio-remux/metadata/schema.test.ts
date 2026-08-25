import { describe, expect, it } from "vitest";
import {
	audioTimelineMetadataSchema,
	validateAudioTimelineMetadata,
} from "../../../src/audio-remux/metadata/schema.js";

const validClip = {
	id: "Root/BGM Track[0]",
	trackPath: "Root/BGM Track",
	sourcePath: "C:/project/Assets/audio/bgm.wav",
	sourceDurationSec: 12.5,
	rootStartSec: 0,
	rootEndSec: 10,
	clipInSec: 0,
	effectiveSpeed: 1,
	clipVolume: 1,
	trackVolume: 0.8,
	trackMuted: false,
	loop: false,
};

const validMetadata = {
	schemaVersion: 1,
	sceneName: "Main",
	extractedAt: "2026-08-23T00:00:00.000Z",
	clips: [validClip],
	errors: [],
	warnings: [],
};

describe("audioTimelineMetadataSchema", () => {
	it("accepts the extraction fixture shape and infers the contract", () => {
		const result = validateAudioTimelineMetadata(validMetadata);

		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value.clips[0]?.id).toBe(validClip.id);
	});

	it.each([
		["missing schemaVersion", { schemaVersion: undefined }],
		["unknown schemaVersion", { schemaVersion: 2 }],
		[
			"non-finite root start",
			{ clips: [{ ...validClip, rootStartSec: Infinity }] },
		],
		["negative root start", { clips: [{ ...validClip, rootStartSec: -1 }] }],
		[
			"non-positive effective speed",
			{ clips: [{ ...validClip, effectiveSpeed: 0 }] },
		],
		["invalid interval", { clips: [{ ...validClip, rootEndSec: 0 }] }],
		["out of range volume", { clips: [{ ...validClip, clipVolume: 1.1 }] }],
		["unknown field", { unexpected: true }],
	])("rejects %s", (_name, override) => {
		const input = { ...validMetadata, ...override };
		expect(audioTimelineMetadataSchema.safeParse(input).success).toBe(false);
	});

	it("rejects malformed extraction errors and warnings", () => {
		expect(
			audioTimelineMetadataSchema.safeParse({
				...validMetadata,
				errors: [{ kind: "unknown", clipId: "clip", detail: "bad" }],
				warnings: [{ kind: "invalid-time-value", clipId: "clip" }],
			}).success,
		).toBe(false);
	});
});
