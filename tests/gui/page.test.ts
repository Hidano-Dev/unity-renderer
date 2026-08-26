import { describe, expect, it } from "vitest";
import { renderPage } from "../../src/gui/page.js";

const page = renderPage("token-1");

describe("GUI page", () => {
	it("offers a scene filter next to the bulk toggles", () => {
		expect(page).toContain('id="sceneFilter"');
		expect(page).toContain('id="clearSceneFilter"');
		expect(page).toContain('id="selectAll"');
		expect(page).toContain('id="selectNone"');
	});

	it("hides filtered-out scenes instead of removing them from the DOM", () => {
		// チェックボックスを消すと、絞り込んだ瞬間に隠れた Scene の選択が
		// checkedSceneNames() から抜け、保存内容が壊れる
		expect(page).toContain("items[i].hidden = !matched");
		expect(page).toContain(".scenes li[hidden] { display: none; }");
	});

	it("applies the bulk toggles only to the visible scenes", () => {
		expect(page).toContain(
			'document.querySelectorAll("#sceneList li:not([hidden]) .scene-check")',
		);
		expect(page).toContain("var boxes = visibleSceneBoxes();");
	});

	it("round-trips the filter through the persisted state", () => {
		expect(page).toContain('sceneFilter: byId("sceneFilter").value');
		expect(page).toContain('byId("sceneFilter").value = state.sceneFilter');
	});

	it("blocks runs while the scene list is being scanned", () => {
		// 走査中に実行を許すと、collect() が新しい projectPath と前の
		// プロジェクトで選んだ Scene 名を組み合わせてしまう
		expect(page).toContain("var busy = running || scenesLoading;");
		expect(page).toContain('byId("runRender").disabled = busy;');
		expect(page).toContain("scenesLoading = true;");
	});

	it("drops the previous scene list when a new scan starts", () => {
		expect(page).toContain("var requestId = (sceneRequest += 1);");
		// 遅れて返った前の走査結果を現在状態へ代入しない
		expect(page).toContain("if (requestId !== sceneRequest) return;");
	});

	it("keeps the token out of the markup except in the bootstrap script", () => {
		expect(page).toContain('window.__GUI_TOKEN__ = "token-1";');
		expect(page).not.toContain("token-1&");
	});
});
