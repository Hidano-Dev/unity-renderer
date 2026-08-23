import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
	FfmpegAcquireManager,
	type FfmpegFetch,
	type FfmpegSmokeTest,
} from "../../../src/audio-remux/ffmpeg/acquire.js";
import { FFMPEG_MANIFEST } from "../../../src/audio-remux/ffmpeg/manifest.js";

const root = () => join(tmpdir(), `ffmpeg-test-${randomUUID()}`);

function zipStored(name: string, data: Uint8Array): Uint8Array {
	const encoder = new TextEncoder();
	const nameBytes = encoder.encode(name);
	const local = new Uint8Array(30 + nameBytes.length + data.length);
	const view = new DataView(local.buffer);
	view.setUint32(0, 0x04034b50, true);
	view.setUint16(4, 20, true);
	view.setUint16(8, 0, true);
	view.setUint32(18, data.length, true);
	view.setUint32(22, data.length, true);
	view.setUint16(26, nameBytes.length, true);
	local.set(nameBytes, 30);
	local.set(data, 30 + nameBytes.length);
	const central = new Uint8Array(46 + nameBytes.length);
	const centralView = new DataView(central.buffer);
	centralView.setUint32(0, 0x02014b50, true);
	centralView.setUint16(4, 20, true);
	centralView.setUint16(6, 20, true);
	centralView.setUint32(20, data.length, true);
	centralView.setUint32(24, data.length, true);
	centralView.setUint16(28, nameBytes.length, true);
	centralView.setUint32(42, 0, true);
	central.set(nameBytes, 46);
	const end = new Uint8Array(22);
	const endView = new DataView(end.buffer);
	endView.setUint32(0, 0x06054b50, true);
	endView.setUint16(8, 1, true);
	endView.setUint16(10, 1, true);
	endView.setUint32(12, central.length, true);
	endView.setUint32(16, local.length, true);
	return new Uint8Array([...local, ...central, ...end]);
}

async function setup() {
	const directory = root();
	await mkdir(directory, { recursive: true });
	return directory;
}

const smokeOk: FfmpegSmokeTest = async () => undefined;
const fetchBytes =
	(body: Uint8Array): FfmpegFetch =>
	async () =>
		new Response(body, { status: 200 });
function testManifest(archive: Uint8Array) {
	return {
		...FFMPEG_MANIFEST,
		sizeBytes: archive.byteLength,
		sha256: createHash("sha256").update(archive).digest("hex"),
	};
}

describe("FfmpegAcquireManager", () => {
	it("keeps the pinned manifest values verbatim", () => {
		expect(FFMPEG_MANIFEST).toMatchObject({
			buildId: "ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1",
			tag: "autobuild-2026-08-22-12-58",
			sha256:
				"aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7",
			sizeBytes: 146078688,
			license: "LGPL-3.0-or-later",
		});
	});

	it("downloads, verifies, extracts, smokes, and records an install", async () => {
		const directory = await setup();
		const bytes = new TextEncoder().encode("fake ffmpeg");
		const archive = zipStored(FFMPEG_MANIFEST.archiveBinaryRelPath, bytes);
		const manifest = testManifest(archive);
		const manager = new FfmpegAcquireManager({
			toolsDirectory: directory,
			manifest,
			fetch: fetchBytes(archive),
			smokeTest: smokeOk,
		});
		const result = await manager.ensureFfmpeg();
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(await readFile(result.value.ffmpegPath, "utf8")).toBe("fake ffmpeg");
		expect(
			await readFile(
				join(directory, FFMPEG_MANIFEST.buildId, "install-info.json"),
				"utf8",
			),
		).toContain(FFMPEG_MANIFEST.buildId);
		await rm(directory, { recursive: true, force: true });
	});

	it("uses a valid manual installation before managed acquisition", async () => {
		const directory = await setup();
		const manual = join(directory, "manual");
		await mkdir(manual, { recursive: true });
		await writeFile(join(manual, "ffmpeg.exe"), "manual");
		const manager = new FfmpegAcquireManager({
			toolsDirectory: directory,
			fetch: async () => {
				throw new Error("network must not be used");
			},
			smokeTest: smokeOk,
		});
		const result = await manager.ensureFfmpeg();
		expect(result).toEqual({
			ok: true,
			value: { ffmpegPath: join(manual, "ffmpeg.exe"), source: "manual" },
		});
		await rm(directory, { recursive: true, force: true });
	});

	it("reports checksum failures with a manual install hint", async () => {
		const directory = await setup();
		const archive = zipStored(
			FFMPEG_MANIFEST.archiveBinaryRelPath,
			new TextEncoder().encode("bad"),
		);
		const manager = new FfmpegAcquireManager({
			toolsDirectory: directory,
			fetch: fetchBytes(archive),
			smokeTest: smokeOk,
		});
		const result = await manager.ensureFfmpeg();
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.kind).toBe("checksum-mismatch");
		expect(result.error.manualInstallHint).toContain("manual");
		await rm(directory, { recursive: true, force: true });
	});

	it("rejects a corrupt archive and a failed smoke test", async () => {
		const directory = await setup();
		const corrupt = new TextEncoder().encode("not a zip");
		const corruptResult = await new FfmpegAcquireManager({
			toolsDirectory: directory,
			manifest: testManifest(corrupt),
			fetch: fetchBytes(corrupt),
			smokeTest: smokeOk,
		}).ensureFfmpeg();
		expect(corruptResult).toMatchObject({
			ok: false,
			error: { kind: "extract-failed" },
		});
		const archive = zipStored(
			FFMPEG_MANIFEST.archiveBinaryRelPath,
			new TextEncoder().encode("fake"),
		);
		const smokeResult = await new FfmpegAcquireManager({
			toolsDirectory: directory,
			manifest: testManifest(archive),
			fetch: fetchBytes(archive),
			smokeTest: async () => {
				throw new Error("not executable");
			},
		}).ensureFfmpeg();
		expect(smokeResult).toMatchObject({
			ok: false,
			error: { kind: "smoke-test-failed" },
		});
		await rm(directory, { recursive: true, force: true });
	});

	it("removes stale locks and serializes concurrent acquisition", async () => {
		const directory = await setup();
		const archive = zipStored(
			FFMPEG_MANIFEST.archiveBinaryRelPath,
			new TextEncoder().encode("fake"),
		);
		const manifest = testManifest(archive);
		await writeFile(join(directory, ".acquire.lock"), JSON.stringify({}));
		let fetchCount = 0;
		const delayedFetch: FfmpegFetch = async () => {
			fetchCount += 1;
			await new Promise((done) => setTimeout(done, 20));
			return new Response(archive, { status: 200 });
		};
		const first = new FfmpegAcquireManager({
			toolsDirectory: directory,
			manifest,
			fetch: delayedFetch,
			smokeTest: smokeOk,
		});
		const second = new FfmpegAcquireManager({
			toolsDirectory: directory,
			manifest,
			fetch: delayedFetch,
			smokeTest: smokeOk,
		});
		const results = await Promise.all([
			first.ensureFfmpeg(),
			second.ensureFfmpeg(),
		]);
		expect(results.every((result) => result.ok)).toBe(true);
		expect(fetchCount).toBe(1);
		await rm(directory, { recursive: true, force: true });
	});
});
