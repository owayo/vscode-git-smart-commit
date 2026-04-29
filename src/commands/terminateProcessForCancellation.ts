import type { ChildProcess } from "node:child_process";
import { spawn } from "child_process";
import type * as vscode from "vscode";

export function terminateProcessForCancellation(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	if (globalThis.process.platform === "win32" && child.pid !== undefined) {
		try {
			const taskkillProcess = spawn(
				"taskkill",
				["/PID", String(child.pid), "/T", "/F"],
				{
					windowsHide: true,
					stdio: "ignore",
				},
			);

			// taskkill の起動失敗を未処理 error イベントにしない
			taskkillProcess.on("error", (error: Error) => {
				outputChannel.appendLine(
					`\n⚠️ Failed to start taskkill: ${error.message}`,
				);
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			outputChannel.appendLine(`\n⚠️ Failed to start taskkill: ${message}`);
		}
		return;
	}

	child.kill("SIGTERM");
}
