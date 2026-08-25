import { Command } from "commander";
import { createAudioRemuxHooks } from "../audio-remux/index.js";
import { createHookRegistry } from "../hooks/registry.js";
import { runCheck } from "./check.js";
import { runInit } from "./init.js";
import { runRender } from "./render.js";

export function createCompositionHooks() {
	const registry = createHookRegistry();
	registry.register(createAudioRemuxHooks());
	return registry.current[0];
}

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
	return program;
}

if (import.meta.main) await createCli().parseAsync(process.argv);
