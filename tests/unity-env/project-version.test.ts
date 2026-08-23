import { describe, expect, it } from "vitest";
import {
	isSupportedUnityVersion,
	parseProjectVersion,
	readProjectVersion,
} from "../../src/unity-env/project-version.js";

describe("project version", () => {
	const versionFile =
		"m_EditorVersion: 6000.0.36f1\nm_EditorVersionWithRevision: 6000.0.36f1 (abc)";

	it("parses m_EditorVersion", () => {
		const result = parseProjectVersion(versionFile);
		expect(result.ok && result.value).toEqual({
			raw: "6000.0.36f1",
			major: 6000,
		});
	});

	it("rejects missing or malformed version", () => {
		expect(parseProjectVersion("m_EditorVersion: nope").ok).toBe(false);
		expect(parseProjectVersion("").ok).toBe(false);
	});

	it("identifies Unity 6 and older versions", () => {
		expect(isSupportedUnityVersion({ raw: "6000.0.0f1", major: 6000 })).toBe(
			true,
		);
		expect(isSupportedUnityVersion({ raw: "2022.3.1f1", major: 2022 })).toBe(
			false,
		);
	});

	it("reads ProjectSettings/ProjectVersion.txt", async () => {
		const result = await readProjectVersion("spike/unity-project");
		expect(result.ok && result.value.raw).toBe("6000.0.36f1");
	});
});
