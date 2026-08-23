/** @impl TAR-5.1 @impl TAR-5.4 */

export interface FfmpegManifest {
	readonly buildId: string;
	readonly tag: string;
	readonly ffmpegVersion: string;
	readonly url: string;
	readonly sha256: string;
	readonly sizeBytes: number;
	readonly archiveBinaryRelPath: string;
	readonly license: "LGPL-3.0-or-later";
	readonly licenseSourceUrl: string;
}

export const FFMPEG_MANIFEST: FfmpegManifest = {
	buildId: "ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1",
	tag: "autobuild-2026-08-22-12-58",
	ffmpegVersion: "n8.1.2-44-g7c533d0f86",
	url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-08-22-12-58/ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1.zip",
	sha256: "aa5ff0d7bfc091f9a43d43f7af4a2174294edacf5cdc5fff031819a5eaa763c7",
	sizeBytes: 146078688,
	archiveBinaryRelPath:
		"ffmpeg-n8.1.2-44-g7c533d0f86-win64-lgpl-8.1/bin/ffmpeg.exe",
	license: "LGPL-3.0-or-later",
	licenseSourceUrl: "https://github.com/BtbN/FFmpeg-Builds",
};
