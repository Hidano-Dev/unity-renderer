import { describe, expect, it } from "vitest";
import { detectUnityCli } from "../../src/unity-env/unity-cli.js";

describe("unity CLI detection", () => {
	it("returns the CLI version when the command is executable", async () => {
		const result = await detectUnityCli(async () => ({
			stdout: "Unity CLI 1.2.3\n",
			stderr: "",
			exitCode: 0,
		}));
		expect(result).toEqual({
			ok: true,
			value: { cliVersion: "Unity CLI 1.2.3" },
		});
	});

	it("returns setup guidance when unity is unavailable", async () => {
		const result = await detectUnityCli(async () => {
			throw new Error("ENOENT");
		});
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("cli-not-found");
			expect(result.error.message).toContain("unity auth login");
		}
	});
});
