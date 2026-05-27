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

function sendSignalFallback(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
	signal: NodeJS.Signals,
): void {
	try {
		if (globalThis.process.platform === "win32") {
			child.kill(signal);
		} else {
			killPosixProcessGroup(child, signal);
		}
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(`\n⚠️ Failed to send ${signal}: ${message}`);
	}
}

/**
 * 後方互換のための薄いラッパー。`signal` は SIGTERM 固定。
 * SIGKILL を送りたい場合は `terminateProcessForCancellation(child, outputChannel, "SIGKILL")` を使う。
 */
function sendSigtermFallback(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
): void {
	sendSignalFallback(child, outputChannel, "SIGTERM");
}

/**
 * キャンセル時に子プロセスを終了させる。
 *
 * - SIGTERM (既定): Windows では `taskkill /T /F` でプロセスツリーを終了、POSIX では
 *   プロセスグループへ `SIGTERM` を送信し、孫プロセス (`git-sc` が起動した `git` 等) も
 *   まとめて停止する。
 * - SIGKILL (POSIX 用昇格): 一定時間経過しても `close` が来ない場合に呼び出し側で起動する
 *   timer から呼ばれる。SIGTERM を `trap "" TERM` 等で無視するプロセスを強制終了する。
 *   Windows では `taskkill /F` 自体が強制終了相当のため、追加昇格は不要 (呼び出し側で
 *   POSIX のみ timer を仕掛ける運用)。
 */
export function terminateProcessForCancellation(
	child: ChildProcess,
	outputChannel: vscode.OutputChannel,
	signal: NodeJS.Signals = "SIGTERM",
): void {
	if (
		globalThis.process.platform === "win32" &&
		signal === "SIGTERM" &&
		child.pid !== undefined
	) {
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

	sendSignalFallback(child, outputChannel, signal);
}
