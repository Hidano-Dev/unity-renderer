import { createAudioRemuxHooks } from "../audio-remux/index.js";
import { createHookRegistry } from "../hooks/registry.js";

/**
 * `render` に載せる hook 一式を組み立てる。CLI 本体(`index.ts`)と GUI の双方が
 * これを使うため、コマンド定義から独立したモジュールに置く。index.ts へ置くと
 * `index.ts -> gui.ts -> index.ts` の循環 import になる。
 */
export function createCompositionHooks() {
	const registry = createHookRegistry();
	registry.register(createAudioRemuxHooks());
	return registry.current[0];
}
