import { describe, expect, it } from "vitest";
import {
	resolveSessionDirectory,
	resolveToolDirectory,
} from "../../src/shared/paths.js";

describe("tool paths", () => {
	it("resolves the tool-owned directory below LOCALAPPDATA", () => {
		const result = resolveToolDirectory({
			env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
		});

		expect(result).toEqual({
			ok: true,
			value: "C:\\Users\\tester\\AppData\\Local\\unity-render-core",
		});
	});

	it("resolves the session directory below the tool-owned directory", () => {
		const result = resolveSessionDirectory({
			env: { LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
		});

		expect(result).toEqual({
			ok: true,
			value: "C:\\Users\\tester\\AppData\\Local\\unity-render-core\\sessions",
		});
	});

	it("returns a classified error when LOCALAPPDATA is unavailable", () => {
		const result = resolveToolDirectory({ env: {} });

		expect(result).toEqual({
			ok: false,
			error: {
				category: "environment",
				code: "localappdata-unavailable",
				message: "LOCALAPPDATA is not set",
			},
		});
	});
});
