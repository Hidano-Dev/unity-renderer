import { readFileSync } from "node:fs";
import { extname } from "node:path";
import { withTrace } from "@hidano/artgraph/vitest/config";
import { defineConfig, type Plugin } from "vitest/config";

const rawCsharpTemplatePlugin: Plugin = {
	name: "raw-csharp-template",
	enforce: "pre",
	load(id: string) {
		if (extname(id) !== ".cs") return;
		return `export default ${JSON.stringify(readFileSync(id, "utf8"))}`;
	},
};

export default defineConfig(
	withTrace({
		plugins: [rawCsharpTemplatePlugin],
		test: {
			include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
			passWithNoTests: true,
		},
	}),
);
