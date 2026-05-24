import type { ChildProcess } from "node:child_process";
import { spawn } from "child_process";
import type * as vscode from "vscode";
import {
	resolveNativeExecutableOnPath,
	resolveWindowsSystemExecutable,
} from "./resolveExecutablePath";

function sendSigtermFallback(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	try {
		child.kill("SIGTERM");
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(`\n⚠️ Failed to send SIGTERM: ${message}`);
	}
}

export function terminateProcessForCancellation(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	if (globalThis.process.platform === "win32" && child.pid !== undefined) {
		let fallbackSent = false;
		const fallbackToSigterm = (): void => {
			if (fallbackSent) {
				return;
			}
			fallbackSent = true;
			sendSigtermFallback(child, outputChannel);
		};
		const taskkillCommand =
			resolveWindowsSystemExecutable("taskkill") ??
			resolveNativeExecutableOnPath("taskkill");
		if (!taskkillCommand) {
			outputChannel.appendLine(
				"\n⚠️ Failed to resolve taskkill executable for cancellation",
			);
			fallbackToSigterm();
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
				fallbackToSigterm();
			});
			taskkillProcess.on("close", (code: number | null) => {
				if (code !== 0) {
					outputChannel.appendLine(
						`\n⚠️ taskkill exited with code ${code ?? "null"}`,
					);
					fallbackToSigterm();
				}
			});
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			outputChannel.appendLine(`\n⚠️ Failed to start taskkill: ${message}`);
			fallbackToSigterm();
		}
		return;
	}

	sendSigtermFallback(child, outputChannel);
}
