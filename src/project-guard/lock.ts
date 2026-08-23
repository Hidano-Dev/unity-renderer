import { type FileHandle, open } from "node:fs/promises";
import path from "node:path";
import { err, ok, type Result } from "../shared/types.js";

/** @impl URC-7.5 */
export interface LockConflictError {
	readonly kind: "project-locked";
	readonly lockfilePath: string;
	readonly message: string;
}

export interface LockCheckOptions {
	/** Injectable for deterministic tests; production uses the OS file opener. */
	readonly open?: (lockfilePath: string) => Promise<FileHandle>;
}

const conflictMessage =
	"The Unity project is already open in another Editor. Close the Editor using this project and try again.";

/**
 * Checks Unity's project lock without treating a leftover lockfile as active.
 *
 * Unity keeps the lockfile open with an exclusive OS sharing mode. Consequently
 * an open failure means another Editor owns it, while a successful open means
 * the file is only a stale artifact and the caller may continue. The check
 * never removes or modifies the lockfile.
 */
export async function checkProjectLock(
	projectPath: string,
	options: LockCheckOptions = {},
): Promise<Result<void, LockConflictError>> {
	const lockfilePath = path.join(projectPath, "Temp", "UnityLockfile");
	const openLockfile = options.open ?? ((filePath) => open(filePath, "r+"));

	let handle: FileHandle;
	try {
		handle = await openLockfile(lockfilePath);
	} catch (cause) {
		if (isMissingFile(cause)) return ok(undefined);
		return err({
			kind: "project-locked",
			lockfilePath,
			message: conflictMessage,
		});
	}

	try {
		await handle.close();
	} catch {
		// A successful exclusive open already proved that no Editor owns it.
		// Closing is best-effort because this is a read-only probe.
	}
	return ok(undefined);
}

function isMissingFile(cause: unknown): boolean {
	return (
		typeof cause === "object" &&
		cause !== null &&
		"code" in cause &&
		(cause as { code?: unknown }).code === "ENOENT"
	);
}
