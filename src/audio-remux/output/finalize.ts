import { randomUUID } from "node:crypto";
import { access, rename, rm, stat } from "node:fs/promises";
import { dirname, join, parse } from "node:path";
import { err, ok, type Result } from "../../shared/types.js";

/** @impl TAR-9.1 @impl TAR-9.2 @impl TAR-9.3 @impl TAR-10.4 @impl TAR-11.3 */

export type FinalizeError =
	| { readonly kind: "verify-failed"; readonly message: string }
	| { readonly kind: "replace-failed"; readonly message: string };

export interface FinalizeResult {
	readonly finalPath: string;
	readonly silentBackupPath?: string;
}

export interface OutputFinalizer {
	finalizeOutput(
		videoPath: string,
		muxedTmpPath: string,
		debug: boolean,
	): Promise<Result<FinalizeResult, FinalizeError>>;
}

function silentBackupPath(videoPath: string): string {
	const parsed = parse(videoPath);
	return join(parsed.dir, `${parsed.name}.noaudio${parsed.ext}`);
}

async function isNonEmptyFile(path: string): Promise<boolean> {
	try {
		const information = await stat(path);
		return information.isFile() && information.size > 0;
	} catch {
		return false;
	}
}

async function exists(path: string): Promise<boolean> {
	try {
		await access(path);
		return true;
	} catch {
		return false;
	}
}

function messageFor(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}

/**
 * Replaces the silent render only after the muxed output has been verified.
 * The intermediate rename keeps the original render recoverable if the final
 * rename fails, including on platforms where rename cannot overwrite files.
 */
export async function finalizeOutput(
	videoPath: string,
	muxedTmpPath: string,
	debug: boolean,
): Promise<Result<FinalizeResult, FinalizeError>> {
	if (!(await isNonEmptyFile(muxedTmpPath)))
		return err({
			kind: "verify-failed",
			message: `Muxed output is missing or empty: ${muxedTmpPath}`,
		});

	if (videoPath === muxedTmpPath)
		return err({
			kind: "replace-failed",
			message: "Final and muxed temporary paths must be different",
		});

	const originalExists = await exists(videoPath);
	const backupPath =
		debug && originalExists ? silentBackupPath(videoPath) : undefined;
	const rollbackPath = join(
		dirname(videoPath),
		`.${parse(videoPath).base}.${process.pid}.${randomUUID()}.replace-backup`,
	);
	let originalMoved = false;

	try {
		if (originalExists) {
			await rename(videoPath, rollbackPath);
			originalMoved = true;
		}
		await rename(muxedTmpPath, videoPath);

		if (backupPath) {
			await rm(backupPath, { force: true });
			await rename(rollbackPath, backupPath);
			originalMoved = false;
		} else if (originalMoved) {
			await rm(rollbackPath, { force: true });
			originalMoved = false;
		}

		return ok({
			finalPath: videoPath,
			...(backupPath && { silentBackupPath: backupPath }),
		});
	} catch (cause) {
		if (originalMoved) {
			try {
				await rm(videoPath, { force: true });
				await rename(rollbackPath, videoPath);
			} catch {
				// Preserve the original replacement error; the rollback attempt is best effort.
			}
		}
		return err({ kind: "replace-failed", message: messageFor(cause) });
	}
}

export class DefaultOutputFinalizer implements OutputFinalizer {
	public finalizeOutput(
		videoPath: string,
		muxedTmpPath: string,
		debug: boolean,
	): Promise<Result<FinalizeResult, FinalizeError>> {
		return finalizeOutput(videoPath, muxedTmpPath, debug);
	}
}
