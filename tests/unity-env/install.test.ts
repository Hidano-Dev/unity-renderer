import { describe, expect, it, vi } from "vitest";
import type { EditorInstall } from "../../src/unity-env/editors.js";
import { ensureEditor } from "../../src/unity-env/install.js";

const required = { raw: "6000.0.36f1", major: 6000 } as const;
const other = {
	version: { raw: "6000.0.23f1", major: 6000 },
	executablePath: "C:\\Unity\\6000.0.23f1\\Editor\\Unity.exe",
} satisfies EditorInstall;
const matching = {
	version: required,
	executablePath: "C:\\Unity\\6000.0.36f1\\Editor\\Unity.exe",
} satisfies EditorInstall;

describe("Unity Editor version matching and install flow", () => {
	it("returns an exact matching Editor without installing", async () => {
		const install = vi.fn();
		const result = await ensureEditor(required, false, {
			listEditors: async () => ({ ok: true, value: [other, matching] }),
			install,
		});

		expect(result).toEqual({ ok: true, value: matching });
		expect(install).not.toHaveBeenCalled();
	});

	it("declines automatically in a non-interactive environment", async () => {
		const install = vi.fn();
		const result = await ensureEditor(required, false, {
			listEditors: async () => ({ ok: true, value: [other] }),
			install,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("install-declined");
		expect(install).not.toHaveBeenCalled();
	});

	it("declines when the user rejects installation", async () => {
		const install = vi.fn();
		const confirm = vi.fn(async () => false);
		const result = await ensureEditor(required, true, {
			listEditors: async () => ({ ok: true, value: [other] }),
			confirmInstall: confirm,
			install,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("install-declined");
		expect(confirm).toHaveBeenCalledWith(required);
		expect(install).not.toHaveBeenCalled();
	});

	it("installs and returns the newly detected matching Editor", async () => {
		let calls = 0;
		const install = vi.fn(async () => ({
			stdout: "",
			stderr: "",
			exitCode: 0,
		}));
		const result = await ensureEditor(required, true, {
			listEditors: async () => {
				calls += 1;
				return { ok: true, value: calls === 1 ? [other] : [other, matching] };
			},
			confirmInstall: async () => true,
			install,
		});

		expect(result).toEqual({ ok: true, value: matching });
		expect(install).toHaveBeenCalledOnce();
	});

	it("fails without touching the project when installation fails", async () => {
		const install = vi.fn(async () => ({
			stdout: "",
			stderr: "network unavailable",
			exitCode: 1,
		}));
		const result = await ensureEditor(required, true, {
			listEditors: async () => ({ ok: true, value: [other] }),
			confirmInstall: async () => true,
			install,
		});

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error.kind).toBe("install-failed");
			expect(result.error.message).toContain("network unavailable");
		}
	});

	it("fails if install succeeds but the requested Editor remains unavailable", async () => {
		const result = await ensureEditor(required, true, {
			listEditors: async () => ({ ok: true, value: [other] }),
			confirmInstall: async () => true,
			install: async () => ({ stdout: "", stderr: "", exitCode: 0 }),
		});

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error.kind).toBe("install-failed");
	});
});
