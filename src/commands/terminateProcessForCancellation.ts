import type { ChildProcess } from "node:child_process";
import { spawn } from "child_process";
import type * as vscode from "vscode";
import {
	resolveNativeExecutableOnPath,
	resolveWindowsSystemExecutable,
} from "./resolveExecutablePath";

/**
 * POSIX で子プロセスとその子孫 (`git-sc` が起動した `git` 等) をまとめて終了させる。
 *
 * `runGitSc` / `rewordCommit` は POSIX で `detached: true` で spawn しており、
 * 子プロセスがプロセスグループのリーダーになっている。負の PID で kill すると
 * 同じグループに属する全プロセスへシグナルが届くため、孫プロセスが残るのを防げる。
 * `process.kill(-pid)` が失敗した場合 (グループ化に失敗していた等) は単体 PID への
 * フォールバックを試みる。
 */
function killPosixProcessGroup(
	child: ChildProcess,
	signal: NodeJS.Signals,
): void {
	if (child.pid !== undefined) {
		try {
			globalThis.process.kill(-child.pid, signal);
			return;
		} catch {
			// グループ kill に失敗した場合は単体 PID へフォールバック
		}
	}
	child.kill(signal);
}

function sendSigtermFallback(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	try {
		if (globalThis.process.platform === "win32") {
			child.kill("SIGTERM");
		} else {
			killPosixProcessGroup(child, "SIGTERM");
		}
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
