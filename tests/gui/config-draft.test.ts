import { describe, expect, it } from "vitest";
import { buildRenderConfigDraft } from "../../src/gui/config-draft.js";
import { defaultGuiState, type GuiState } from "../../src/gui/state.js";

const ready: GuiState = {
	...defaultGuiState,
	projectPath: "D:\\proj",
	outputDirectory: "D:\\out",
};

describe("buildRenderConfigDraft", () => {
	it("builds a config that passes the CLI schema", () => {
		const draft = buildRenderConfigDraft(ready, ["Main", "Title"]);

		expect(draft).toEqual({
			ok: true,
			value: {
				projectPath: "D:\\proj",
				scenes: ["Main", "Title"],
				resolution: { width: 1920, height: 1080 },
				frameRate: 30,
				formats: ["mp4"],
				output: { directory: "D:\\out", fileName: "<Scene>_<Take>" },
				debug: false,
			},
		});
	});

	it("reports every empty field at once, in Japanese", () => {
		const draft = buildRenderConfigDraft(defaultGuiState, []);

		expect(draft.ok).toBe(false);
		if (draft.ok) return;
		expect(draft.error.map((issue) => issue.path)).toEqual([
			"projectPath",
			"scenes",
			"output.directory",
		]);
		expect(draft.error[0]?.message).toContain("Unity プロジェクト");
	});

	it("asks for a Scene when nothing is checked", () => {
		const draft = buildRenderConfigDraft(ready, []);

		expect(draft.ok).toBe(false);
		if (draft.ok) return;
		expect(draft.error).toEqual([
			{ path: "scenes", message: "書き出す Scene を 1 つ以上選択してください" },
		]);
	});

	it("surfaces schema failures such as an unknown output wildcard", () => {
		const draft = buildRenderConfigDraft({ ...ready, fileName: "<Nope>" }, [
			"Main",
		]);

		expect(draft.ok).toBe(false);
		if (draft.ok) return;
		expect(draft.error[0]?.path).toBe("output.fileName");
		expect(draft.error[0]?.message).toContain("unknown wildcard");
	});

	it("surfaces a file name that Windows cannot create", () => {
		const draft = buildRenderConfigDraft({ ...ready, fileName: "a?b" }, [
			"Main",
		]);

		expect(draft.ok).toBe(false);
		if (draft.ok) return;
		expect(draft.error[0]?.path).toBe("output.fileName");
	});
});
