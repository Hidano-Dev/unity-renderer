import { withTrace } from "@hidano/artgraph/vitest/config";
import { defineConfig } from "vitest/config";

export default defineConfig(
	withTrace({
		test: {
			include: ["tests/**/*.test.ts", "tests/**/*.spec.ts"],
			passWithNoTests: true,
		},
	}),
);
