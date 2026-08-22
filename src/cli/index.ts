import { Command } from "commander";
import { runRender } from "./render.js";

/** @impl URC-15.1 */
export function createCli(): Command {
	const program = new Command();
	program.name("unity-render").description("Unity batch render tool");
	program
		.command("render <config>")
		.description("Render all configured Scenes")
		.action(async (config: string) => {
			process.exitCode = await runRender(config);
		});
	return program;
}

if (import.meta.main) await createCli().parseAsync(process.argv);
