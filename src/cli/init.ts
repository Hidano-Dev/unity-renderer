import { writeFile } from "node:fs/promises";
import { generateTemplate } from "../config/template.js";

/** @impl URC-15.3 */
export interface InitOptions {
	readonly force?: boolean;
	readonly write?: (
		filePath: string,
		contents: string,
		flag?: string,
	) => Promise<void>;
}

export async function runInit(
	outputPath = "render-config.json",
	options: InitOptions = {},
): Promise<0 | 1> {
	const write =
		options.write ??
		((filePath, contents, flag) =>
			writeFile(filePath, contents, { encoding: "utf8", flag }));
	try {
		await write(outputPath, generateTemplate(), options.force ? "w" : "wx");
		return 0;
	} catch (cause) {
		if ((cause as NodeJS.ErrnoException).code === "EEXIST") {
			process.stderr.write(
				`Error: ${outputPath} already exists. Use --force to overwrite it.\n`,
			);
			return 1;
		}
		process.stderr.write(
			`Error: could not create ${outputPath}: ${cause instanceof Error ? cause.message : String(cause)}\n`,
		);
		return 1;
	}
}
