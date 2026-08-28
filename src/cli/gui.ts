import { spawn } from "node:child_process";
import type { AddressInfo } from "node:net";
import path from "node:path";
import { createGuiServer, type GuiServerDeps } from "../gui/server.js";

/** GUI が組み立てた設定の書き出し先。CLI からも同じファイルを使い回せる。 */
export const DEFAULT_GUI_CONFIG_FILE = "render-config.json";

export interface GuiOptions {
	readonly openBrowser?: boolean;
	readonly port?: number;
	readonly configPath?: string;
	readonly write?: (message: string) => void;
	readonly openUrl?: (url: string) => void;
	readonly serverDeps?: Partial<GuiServerDeps>;
}

function openInBrowser(url: string): void {
	if (process.platform !== "win32") return;
	// start の第 1 引数はウィンドウタイトル扱いになるため、空文字を挟む
	const child = spawn("cmd", ["/c", "start", "", url], {
		detached: true,
		stdio: "ignore",
		windowsHide: true,
	});
	child.on("error", () => {
		/* 既定ブラウザを開けなくても、表示済みの URL から手動で開ける */
	});
	child.unref();
}

/** listen できるポートか。NaN や小数を渡すと listen が同期的に投げる。 */
export function isListenablePort(port: number): boolean {
	return Number.isInteger(port) && port >= 1 && port <= 65_535;
}

export async function runGui(options: GuiOptions = {}): Promise<0 | 1> {
	const write =
		options.write ??
		((message: string) => process.stdout.write(`${message}\n`));

	// server.listen は範囲外の値に対して ERR_SOCKET_BAD_PORT を同期的に投げる。
	// error イベントでは拾えず、案内のない reject になってしまう
	if (options.port !== undefined && !isListenablePort(options.port)) {
		write(
			`Error: --port には 1〜65535 の整数を指定してください (受け取った値: ${options.port})。`,
		);
		return 1;
	}

	const configPath = path.resolve(
		options.configPath ?? path.join(process.cwd(), DEFAULT_GUI_CONFIG_FILE),
	);

	const { server, token } = createGuiServer({
		configPath,
		...options.serverDeps,
	});

	return await new Promise<0 | 1>((resolve) => {
		server.once("error", (cause: NodeJS.ErrnoException) => {
			write(
				cause.code === "EADDRINUSE"
					? `Error: ポート ${options.port} はすでに使用されています。--port を変えて実行してください。`
					: `Error: ${cause.message}`,
			);
			resolve(1);
		});

		server.listen(options.port ?? 0, "127.0.0.1", () => {
			const address = server.address() as AddressInfo;
			const url = `http://127.0.0.1:${address.port}/?t=${encodeURIComponent(token)}`;
			write("Unity Render の設定画面を開きました。");
			write(`URL: ${url}`);
			write(`設定ファイル: ${configPath}`);
			write("終了するには、この画面で Ctrl+C を押してください。");
			if (options.openBrowser !== false)
				(options.openUrl ?? openInBrowser)(url);
		});

		const shutdown = (): void => {
			server.close(() => resolve(0));
			// 開いたままの SSE 接続があると close は待ち続けるため、明示的に切る
			server.closeAllConnections?.();
		};
		process.once("SIGINT", shutdown);
		process.once("SIGTERM", shutdown);
	});
}
