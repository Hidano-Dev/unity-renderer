/** @impl URC-13.4 @impl URC-13.5 */
import type { BatchResult } from "./progress.js";

export type { BatchResult } from "./progress.js";

export function toExitCode(result: BatchResult): 0 | 2 | 3 {
	if (!result.restoreSucceeded) return 3;
	if (result.scenes.some((scene) => scene.outcome === "failure")) return 2;
	return 0;
}
