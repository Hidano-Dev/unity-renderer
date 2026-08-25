import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { type CommonError, err, ok, type Result } from "../shared/types.js";

const execFileAsync = promisify(execFile);

/** ユーザーがダイアログを操作している間は待つ。放置された窓を無限に抱えない上限。 */
const PICKER_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * ブラウザからはフォルダの絶対パスを取れない(`webkitdirectory` はファイル一覧
 * しか返さない)ため、サーバー側から Windows 標準のフォルダ選択ダイアログを出す。
 *
 * スクリプトは ASCII のみで書く。PowerShell へ渡す文字列に非 ASCII を混ぜると
 * コードページ次第で壊れるため、説明文はダイアログ既定のものを使う。
 * 逆に選択されたパスには日本語が入りうるので、出力側だけ UTF-8 に固定する。
 */
const PICKER_SCRIPT = [
	"[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
	"Add-Type -AssemblyName System.Windows.Forms | Out-Null",
	"$dialog = New-Object System.Windows.Forms.FolderBrowserDialog",
	"$dialog.ShowNewFolderButton = $true",
	"if ($env:UNITY_RENDER_PICKER_START) { $dialog.SelectedPath = $env:UNITY_RENDER_PICKER_START }",
	// 既定ブラウザの前面に出さないと、押した本人からはダイアログが見えない
	"$owner = New-Object System.Windows.Forms.Form",
	"$owner.TopMost = $true",
	"$result = $dialog.ShowDialog($owner)",
	"$owner.Dispose()",
	"if ($result -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($dialog.SelectedPath) }",
].join("; ");

export interface FolderPickerOptions {
	readonly startPath?: string;
	readonly platform?: NodeJS.Platform;
}

/** 選択されたフォルダ。キャンセル時は `undefined`。 */
export async function pickFolder(
	options: FolderPickerOptions = {},
): Promise<Result<string | undefined, CommonError>> {
	if ((options.platform ?? process.platform) !== "win32")
		return err({
			category: "environment",
			code: "folder-picker-unsupported",
			message:
				"フォルダ選択ダイアログは Windows でのみ使用できます。パスを直接入力してください。",
		});

	try {
		const { stdout } = await execFileAsync(
			"powershell.exe",
			["-NoProfile", "-NonInteractive", "-STA", "-Command", PICKER_SCRIPT],
			{
				windowsHide: true,
				timeout: PICKER_TIMEOUT_MS,
				env: {
					...process.env,
					UNITY_RENDER_PICKER_START: options.startPath ?? "",
				},
			},
		);
		const selected = stdout.trim();
		return ok(selected === "" ? undefined : selected);
	} catch (cause) {
		return err({
			category: "environment",
			code: "folder-picker-failed",
			message: `フォルダ選択ダイアログを開けませんでした: ${cause instanceof Error ? cause.message : String(cause)}`,
			cause,
		});
	}
}
