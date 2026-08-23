import { describe, expect, it } from "vitest";
import { parseEditorsOutput } from "../../src/unity-env/editors.js";

describe("unity editors output", () => {
	it("parses the captured table output and ignores headers", () => {
		const output = [
			"Version       Location",
			"6000.0.36f1   C:\\Program Files\\Unity\\Hub\\Editor\\6000.0.36f1\\Editor\\Unity.exe",
			"2022.3.50f1 | C:\\Unity\\2022.3.50f1\\Editor\\Unity.exe",
		].join("\n");
		const result = parseEditorsOutput(output);
		expect(result.ok).toBe(true);
		if (result.ok) expect(result.value).toHaveLength(2);
		if (result.ok) expect(result.value[0]?.version.raw).toBe("6000.0.36f1");
	});

	it("reports malformed output rather than returning a partial install", () => {
		const result = parseEditorsOutput("Version\\nnot an editor");
		expect(result.ok).toBe(false);
	});
});
