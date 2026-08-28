import { describe, expect, it } from "vitest";
import { isListenablePort, runGui } from "../../src/cli/gui.js";

describe("gui command", () => {
	it("reports an out-of-range port instead of letting listen throw", async () => {
		// server.listen は NaN・小数・範囲外に対して ERR_SOCKET_BAD_PORT を
		// 同期的に投げる。error イベントでは拾えず、案内のない reject になる
		for (const port of [Number.NaN, 0, -1, 1.5, 65_536]) {
			const lines: string[] = [];
			const code = await runGui({
				port,
				openBrowser: false,
				write: (line) => lines.push(line),
			});

			expect(code).toBe(1);
			expect(lines.join("\n")).toContain("--port には 1〜65535 の整数");
		}
	});

	it("accepts the ports listen can actually bind", () => {
		expect(isListenablePort(1)).toBe(true);
		expect(isListenablePort(8080)).toBe(true);
		expect(isListenablePort(65_535)).toBe(true);
	});
});
