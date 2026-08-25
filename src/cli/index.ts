import { Command } from "commander";
import { runCheck } from "./check.js";
import { createCompositionHooks } from "./composition.js";
import { runGui } from "./gui.js";
import { runInit } from "./init.js";
import { runRender } from "./render.js";

export { createCompositionHooks } from "./composition.js";

/** @impl URC-15.1 */
export function createCli(): Command {
	const program = new Command();
	program.name("unity-render").description("Unity batch render tool");
	program
		.command("render <config>")
		.description("Render all configured Scenes")
		.action(async (config: string) => {
			process.exitCode = await runRender(config, {
				hooks: createCompositionHooks(),
			});
		});
	program
		.command("check <config>")
		.description(
			"Validate configuration and Unity preflight without starting the Editor",
		)
		.action(async (config: string) => {
			process.exitCode = await runCheck(config);
		});
	program
		.command("init [output]")
		.description("Create a render configuration template")
		.option("-f, --force", "overwrite an existing file")
		.action(
			async (output: string | undefined, options: { force?: boolean }) => {
				process.exitCode = await runInit(output, options);
			},
		);
	program
		.command("gui")
		.description("Open the Scene selection window in the default browser")
		.option("--no-open", "start the local server without opening a browser")
		.option("--port <port>", "listen on a fixed port instead of a free one")
		.action(async (options: { open?: boolean; port?: string }) => {
			process.exitCode = await runGui({
				openBrowser: options.open !== false,
				port: options.port === undefined ? undefined : Number(options.port),
			});
		});
	return program;
}

if (import.meta.main) await createCli().parseAsync(process.argv);
