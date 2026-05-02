import type { ChildProcess } from "node:child_process";
import { spawn } from "child_process";
import type * as vscode from "vscode";
import {
	resolveNativeExecutableOnPath,
	resolveWindowsSystemExecutable,
} from "./resolveExecutablePath";

export function terminateProcessForCancellation(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	if (globalThis.process.platform === "win32" && child.pid !== undefined) {
		const taskkillCommand =
			resolveWindowsSystemExecutable("taskkill") ??
			resolveNativeExecutableOnPath("taskkill");
		if (!taskkillCommand) {
			outputChannel.appendLine(
				"\n⚠️ Failed to resolve taskkill executable for cancellation",
			);
			return;
		}

		try {
			const taskkillProcess = spawn(
				taskkillCommand,
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
			taskkillProcess.on("close", (code: number | null) => {
				if (code !== 0) {
					outputChannel.appendLine(
						`\n⚠️ taskkill exited with code ${code ?? "null"}`,
					);
				}
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			outputChannel.appendLine(`\n⚠️ Failed to start taskkill: ${message}`);
		}
		return;
	}

	child.kill("SIGTERM");
}
