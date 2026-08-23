import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import {
	access,
	mkdir,
	open,
	readFile,
	rename,
	rm,
	writeFile,
} from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { promisify } from "node:util";
import { err, ok, type Result } from "../../shared/types.js";
import { FFMPEG_MANIFEST, type FfmpegManifest } from "./manifest.js";

/** @impl TAR-5.1 @impl TAR-5.3 @impl TAR-5.5 @impl TAR-5.6 @impl TAR-5.7 */

const execFileAsync = promisify(execFile);
export type FfmpegFetch = (url: string) => Promise<Response>;
export type FfmpegSmokeTest = (ffmpegPath: string) => Promise<void>;

export type FfmpegAcquireError = {
	readonly kind:
		| "network"
		| "checksum-mismatch"
		| "extract-failed"
		| "smoke-test-failed"
		| "io-permission"
		| "lock-timeout";
	readonly message: string;
	readonly manualInstallHint: string;
};
export type FfmpegBinary = {
	readonly ffmpegPath: string;
	readonly source: "managed" | "manual";
};

export interface FfmpegAcquireOptions {
	readonly toolsDirectory?: string;
	readonly manifest?: FfmpegManifest;
	readonly fetch?: FfmpegFetch;
	readonly smokeTest?: FfmpegSmokeTest;
}

const defaultFetch: FfmpegFetch = (url) => fetch(url);
const defaultSmoke: FfmpegSmokeTest = async (path) => {
	await execFileAsync(path, ["-version"], { windowsHide: true });
};

function defaultToolsDirectory(): string {
	return join(
		process.env.LOCALAPPDATA ?? join(homedir(), "AppData", "Local"),
		"unity-render-core",
		"tools",
		"ffmpeg",
	);
}

function hint(manifest: FfmpegManifest, manualDirectory: string): string {
	return `Download ${manifest.url} and place ffmpeg.exe at ${join(manualDirectory, "ffmpeg.exe")}.`;
}

function failure(
	kind: FfmpegAcquireError["kind"],
	message: string,
	manifest: FfmpegManifest,
	manual: string,
): Result<never, FfmpegAcquireError> {
	return err({ kind, message, manualInstallHint: hint(manifest, manual) });
}

const NETWORK_CODES = new Set([
	"ENOTFOUND",
	"EAI_AGAIN",
	"ECONNREFUSED",
	"ECONNRESET",
	"ETIMEDOUT",
	"EHOSTUNREACH",
	"ENETUNREACH",
	"ENETDOWN",
	"EPROTO",
	"UND_ERR_CONNECT_TIMEOUT",
	"UND_ERR_SOCKET",
	"UND_ERR_HEADERS_TIMEOUT",
	"CERT_HAS_EXPIRED",
	"UNABLE_TO_VERIFY_LEAF_SIGNATURE",
	"DEPTH_ZERO_SELF_SIGNED_CERT",
	"SELF_SIGNED_CERT_IN_CHAIN",
]);
const PERMISSION_CODES = new Set([
	"EACCES",
	"EPERM",
	"EROFS",
	"EBUSY",
	"ENOSPC",
	"EMFILE",
]);

/**
 * 失敗原因を切り分ける（5.6）。fetch はオフライン・DNS・プロキシ・TLS の
 * いずれでも `TypeError("fetch failed")` を投げ、実際の理由は `cause` 側の
 * `code` にぶら下がる。ここで拾わないと、ネットワーク断が権限エラーとして
 * 報告され、ユーザーが誤った対処へ誘導される。
 */
function classifyAcquireFailure(cause: unknown): FfmpegAcquireError["kind"] {
	if (!(cause instanceof Error)) return "io-permission";
	if (cause.message.includes("ZIP")) return "extract-failed";
	if (cause.message.includes("smoke")) return "smoke-test-failed";

	const codes: string[] = [];
	let current: unknown = cause;
	for (
		let depth = 0;
		current !== null && current !== undefined && depth < 5;
		depth++
	) {
		const record = current as { code?: unknown; cause?: unknown };
		if (typeof record.code === "string") codes.push(record.code);
		current = record.cause;
	}

	if (codes.some((code) => NETWORK_CODES.has(code))) return "network";
	if (codes.some((code) => PERMISSION_CODES.has(code))) return "io-permission";
	if (
		cause instanceof TypeError ||
		/fetch failed|network|socket|proxy|tls|ssl|certificate/i.test(cause.message)
	)
		return "network";
	return "io-permission";
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path, constants.F_OK);
		return true;
	} catch {
		return false;
	}
}

async function sha256(bytes: Uint8Array): Promise<string> {
	return createHash("sha256").update(bytes).digest("hex");
}

function u16(view: DataView, offset: number): number {
	return view.getUint16(offset, true);
}
function u32(view: DataView, offset: number): number {
	return view.getUint32(offset, true);
}

async function extractZip(
	archive: Uint8Array,
	destination: string,
): Promise<void> {
	const view = new DataView(
		archive.buffer,
		archive.byteOffset,
		archive.byteLength,
	);
	let offset = 0;
	while (offset + 30 <= archive.byteLength) {
		if (u32(view, offset) !== 0x04034b50) break;
		const method = u16(view, offset + 8);
		const compressedSize = u32(view, offset + 18);
		const nameLength = u16(view, offset + 26);
		const extraLength = u16(view, offset + 28);
		const name = new TextDecoder().decode(
			archive.subarray(offset + 30, offset + 30 + nameLength),
		);
		const start = offset + 30 + nameLength + extraLength;
		const compressed = archive.subarray(start, start + compressedSize);
		if (name.includes("..") || isAbsolute(name))
			throw new Error("unsafe ZIP entry");
		const data =
			method === 0
				? compressed
				: method === 8
					? await import("node:zlib").then(({ inflateRaw }) =>
							promisify(inflateRaw)(compressed),
						)
					: undefined;
		if (!data) throw new Error(`unsupported ZIP compression method: ${method}`);
		const target = resolve(destination, name);
		// biome-ignore lint/style/useTemplate: the trailing separator must remain a literal backslash
		if (!target.startsWith(resolve(destination) + "\\"))
			throw new Error("unsafe ZIP entry");
		await mkdir(dirname(target), { recursive: true });
		await writeFile(target, data);
		offset = start + compressedSize;
	}
	if (offset === 0) throw new Error("ZIP local header not found");
}

async function lockOwnerAlive(path: string): Promise<boolean> {
	try {
		const record = JSON.parse(await readFile(path, "utf8")) as { pid?: number };
		if (!record.pid) return false;
		try {
			process.kill(record.pid, 0);
			return true;
		} catch {
			return false;
		}
	} catch {
		return false;
	}
}

export class FfmpegAcquireManager {
	private readonly toolsDirectory: string;
	private readonly manifest: FfmpegManifest;
	private readonly fetch: FfmpegFetch;
	private readonly smokeTest: FfmpegSmokeTest;

	public constructor(options: FfmpegAcquireOptions = {}) {
		this.toolsDirectory = options.toolsDirectory ?? defaultToolsDirectory();
		this.manifest = options.manifest ?? FFMPEG_MANIFEST;
		this.fetch = options.fetch ?? defaultFetch;
		this.smokeTest = options.smokeTest ?? defaultSmoke;
	}

	public async ensureFfmpeg(): Promise<
		Result<FfmpegBinary, FfmpegAcquireError>
	> {
		const manualDirectory = join(this.toolsDirectory, "manual");
		const manualPath = join(manualDirectory, "ffmpeg.exe");
		if (await exists(manualPath)) {
			try {
				await this.smokeTest(manualPath);
				return ok({ ffmpegPath: manualPath, source: "manual" });
			} catch {
				/* fall through to the pinned managed build */
			}
		}
		const managedDirectory = join(this.toolsDirectory, this.manifest.buildId);
		const managedPath = join(
			managedDirectory,
			this.manifest.archiveBinaryRelPath,
		);
		if (await exists(managedPath)) {
			try {
				await this.smokeTest(managedPath);
				return ok({ ffmpegPath: managedPath, source: "managed" });
			} catch {
				await rm(managedDirectory, { recursive: true, force: true });
			}
		}
		const lock = join(this.toolsDirectory, ".acquire.lock");
		const acquired = await this.acquireLock(lock);
		if (!acquired)
			return failure(
				"lock-timeout",
				"timed out waiting for another ffmpeg acquisition",
				this.manifest,
				manualDirectory,
			);
		try {
			if (await exists(managedPath)) {
				try {
					await this.smokeTest(managedPath);
					return ok({ ffmpegPath: managedPath, source: "managed" });
				} catch {
					await rm(managedDirectory, { recursive: true, force: true });
				}
			}
			return await this.download(managedDirectory, manualDirectory);
		} finally {
			await rm(lock, { force: true });
		}
	}

	private async acquireLock(lock: string): Promise<boolean> {
		await mkdir(this.toolsDirectory, { recursive: true });
		const deadline = Date.now() + 10_000;
		while (Date.now() < deadline) {
			try {
				const handle = await open(lock, "wx");
				await handle.writeFile(JSON.stringify({ pid: process.pid }));
				await handle.close();
				return true;
			} catch (cause) {
				if ((cause as NodeJS.ErrnoException).code !== "EEXIST") return false;
				if (!(await lockOwnerAlive(lock))) {
					await rm(lock, { force: true });
					continue;
				}
				await new Promise((done) => setTimeout(done, 50));
			}
		}
		return false;
	}

	private async download(
		managedDirectory: string,
		manualDirectory: string,
	): Promise<Result<FfmpegBinary, FfmpegAcquireError>> {
		const staging = join(
			this.toolsDirectory,
			`.staging-${process.pid}-${Date.now()}`,
		);
		const archivePath = join(staging, "archive.zip");
		try {
			const response = await this.fetch(this.manifest.url);
			if (!response.ok)
				return failure(
					"network",
					`ffmpeg download failed with HTTP ${response.status}`,
					this.manifest,
					manualDirectory,
				);
			const bytes = new Uint8Array(await response.arrayBuffer());
			if (bytes.byteLength !== this.manifest.sizeBytes)
				return failure(
					"checksum-mismatch",
					`download size mismatch: expected ${this.manifest.sizeBytes}, got ${bytes.byteLength}`,
					this.manifest,
					manualDirectory,
				);
			if ((await sha256(bytes)) !== this.manifest.sha256)
				return failure(
					"checksum-mismatch",
					"download SHA-256 does not match the pinned manifest",
					this.manifest,
					manualDirectory,
				);
			await mkdir(staging, { recursive: true });
			await writeFile(archivePath, bytes);
			await extractZip(bytes, staging);
			const extracted = join(staging, this.manifest.archiveBinaryRelPath);
			if (!(await exists(extracted)))
				return failure(
					"extract-failed",
					`archive does not contain ${this.manifest.archiveBinaryRelPath}`,
					this.manifest,
					manualDirectory,
				);
			try {
				await this.smokeTest(extracted);
			} catch (cause) {
				throw new Error(
					`smoke test failed: ${cause instanceof Error ? cause.message : String(cause)}`,
				);
			}
			await writeFile(
				join(staging, "install-info.json"),
				JSON.stringify(
					{
						buildId: this.manifest.buildId,
						tag: this.manifest.tag,
						url: this.manifest.url,
						sha256: this.manifest.sha256,
						license: this.manifest.license,
						installedAt: new Date().toISOString(),
					},
					null,
					2,
				),
			);
			await rm(archivePath, { force: true });
			await rename(staging, managedDirectory);
			return ok({
				ffmpegPath: join(managedDirectory, this.manifest.archiveBinaryRelPath),
				source: "managed",
			});
		} catch (cause) {
			return failure(
				classifyAcquireFailure(cause),
				cause instanceof Error ? cause.message : "ffmpeg acquisition failed",
				this.manifest,
				manualDirectory,
			);
		} finally {
			await rm(staging, { recursive: true, force: true });
		}
	}
}

export function createFfmpegAcquireManager(
	options?: FfmpegAcquireOptions,
): FfmpegAcquireManager {
	return new FfmpegAcquireManager(options);
}
