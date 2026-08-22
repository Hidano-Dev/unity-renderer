import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runInit } from "../../src/cli/init.js";
import { validateRenderConfig } from "../../src/config/schema.js";

describe("init command", () => {
	it("writes a complete schema-valid JSON template", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-init-"));
		try {
			const output = path.join(root, "render-config.json");
			expect(await runInit(output)).toBe(0);
			const parsed: unknown = JSON.parse(await readFile(output, "utf8"));
			expect(validateRenderConfig(parsed).ok).toBe(true);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("does not overwrite an existing file unless forced", async () => {
		const root = await mkdtemp(path.join(tmpdir(), "unity-init-"));
		try {
			const output = path.join(root, "render-config.json");
			await runInit(output);
			expect(await runInit(output)).toBe(1);
			expect(await runInit(output, { force: true })).toBe(0);
			await access(output);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
