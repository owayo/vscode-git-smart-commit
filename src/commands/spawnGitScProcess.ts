import { spawn } from "child_process";
import * as vscode from "vscode";
import { isCommandNotFoundError } from "./isCommandNotFoundError";
import { resolveSpawnCommand } from "./resolveExecutablePath";
import { terminateProcessForCancellation } from "./terminateProcessForCancellation";

const GIT_SC_INSTALLATION_URL =
	"https://github.com/owayo/git-smart-commit#installation";

/**
 * `git-sc` が PATH 上に見つからない場合に、インストール案内付きのエラー通知を表示する。
 */
function showGitScNotFoundMessage(): void {
	vscode.window
		.showErrorMessage(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		)
		.then((selection) => {
			if (selection === "View Installation") {
				vscode.env.openExternal(vscode.Uri.parse(GIT_SC_INSTALLATION_URL));
			}
		});
}

/**
 * `git-sc` 実行フロー (commit / reword) ごとに差し替える表示文言。
 * 共通の spawn / 進捗 / キャンセル状態機械はヘルパー側に固定し、
 * フロー固有の文言だけをここで受け取る。
 */
export interface SpawnGitScProcessMessages {
	/** withProgress に表示する進捗メッセージ */
	readonly progressMessage: string;
	/** 成功時に outputChannel へ出力する行 (装飾アイコン込み) */
	readonly successOutputLine: string;
	/** 成功時の showInformationMessage 文言 */
	readonly successNotification: string;
	/** 失敗時に outputChannel へ出力する prefix (`... with code <code>` が続く) */
	readonly failureOutputPrefix: string;
	/** 失敗時の showErrorMessage prefix (`: <errorMessage>` が続く) */
	readonly failureNotificationPrefix: string;
	/** キャンセル時に outputChannel へ出力する行 (装飾アイコン込み) */
	readonly cancellationOutputLine: string;
}

export interface SpawnGitScWithProgressOptions {
	readonly outputChannel: vscode.OutputChannel;
	readonly workspaceRoot: string;
	/** `git-sc` に渡す引数。表示用コマンド文字列もここから組み立てる */
	readonly args: readonly string[];
	readonly messages: SpawnGitScProcessMessages;
}

/**
 * `git-sc` を安全に spawn し、VS Code の進捗表示・キャンセル・後始末をまとめて担う共通ヘルパー。
 *
 * commit フロー ({@link runGitSc}) と reword フロー (runGitScReword) で完全に同一だった
 * spawn + キャンセル状態機械を 1 箇所へ集約し、security-sensitive な挙動の修正漏れを防ぐ。
 * フロー固有の差分 (引数・表示文言) のみ {@link SpawnGitScWithProgressOptions} で受け取る。
 */
export async function spawnGitScWithProgress({
	outputChannel,
	workspaceRoot,
	args,
	messages,
}: SpawnGitScWithProgressOptions): Promise<void> {
	outputChannel.show(true);
	outputChannel.appendLine(`\n${"=".repeat(50)}`);
	outputChannel.appendLine(
		`[${new Date().toLocaleTimeString()}] Running: git-sc ${args.join(" ")}`,
	);
	outputChannel.appendLine(`Working directory: ${workspaceRoot}`);
	outputChannel.appendLine("=".repeat(50));

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Git Smart Commit",
			cancellable: true,
		},
		async (progress, token) => {
			return new Promise<void>((resolve, reject) => {
				let isCancelled = false;
				let settled = false;
				let forceKillTimer: ReturnType<typeof setTimeout> | undefined;

				const clearForceKillTimer = (): void => {
					if (forceKillTimer !== undefined) {
						clearTimeout(forceKillTimer);
						forceKillTimer = undefined;
					}
				};

				const resolveOnce = (): void => {
					if (!settled) {
						settled = true;
						clearForceKillTimer();
						resolve();
					}
				};

				const rejectOnce = (error: Error): void => {
					if (!settled) {
						settled = true;
						clearForceKillTimer();
						reject(error);
					}
				};

				progress.report({ message: messages.progressMessage });

				// 安全な spawn のための解決:
				// - PATH は絶対パス要素だけを走査し、空要素・"."・相対要素による cwd ハイジャック
				//   (悪意ある repo 直下の git-sc を優先実行する攻撃) を防ぐ
				// - POSIX: shell: false で起動し、detached: true でプロセスグループを作って
				//   キャンセル時に子孫プロセス (git-sc が起動する git 等) も含めて終了させる
				// - Windows .exe 等: shell: false で直接起動
				// - Windows .cmd/.bat: cmd.exe を System32 から絶対パスで解決し、
				//   windowsVerbatimArguments: true で生 command line を渡す。各引数は
				//   CommandLineToArgvW 互換で自前 quote 済みなので Node.js DEP0190 の
				//   "shell:true + args の unsafe な空白連結" を回避できる
				const resolved = resolveSpawnCommand("git-sc", args);
				if (!resolved) {
					// PATH に安全な絶対パスが見つからない場合は spawn せず、
					// インストール案内へフォールバックする (フォールバック起動は
					// cwd ハイジャックが残るため避ける)
					outputChannel.appendLine(
						"\n❌ git-sc not found in PATH. Aborting before unsafe spawn.",
					);
					showGitScNotFoundMessage();
					rejectOnce(new Error("git-sc command not found in PATH"));
					return;
				}
				const isPosix = globalThis.process.platform !== "win32";
				const process = spawn(resolved.command, resolved.args, {
					cwd: workspaceRoot,
					shell: false,
					detached: isPosix,
					windowsVerbatimArguments: resolved.windowsVerbatimArguments,
					env: { ...globalThis.process.env, FORCE_COLOR: "0" },
					windowsHide: true,
				});

				let stdout = "";
				let stderr = "";

				process.stdout.on("data", (data: Buffer) => {
					const text = data.toString();
					stdout += text;
					outputChannel.append(text);
				});

				process.stderr.on("data", (data: Buffer) => {
					const text = data.toString();
					stderr += text;
					outputChannel.append(text);
				});

				process.on("close", (code: number | null) => {
					// 既に error / cancel 等で確定済みの場合は何もしない
					// （POSIX では spawn 失敗時に error → close が連続発火するため、
					// UI 通知や outputChannel 出力の二重化を防ぐ）
					if (settled) {
						return;
					}
					if (isCancelled) {
						resolveOnce();
						return;
					}

					if (code === 0) {
						outputChannel.appendLine(`\n${messages.successOutputLine}`);
						vscode.window.showInformationMessage(messages.successNotification);

						// Git 拡張の状態表示を更新（拡張未登録/無効時の reject を捕捉）
						Promise.resolve(
							vscode.commands.executeCommand("git.refresh"),
						).catch((error: unknown) => {
							const message =
								error instanceof Error ? error.message : String(error);
							outputChannel.appendLine(`⚠️ Git refresh failed: ${message}`);
						});
						resolveOnce();
					} else {
						const errorMessage =
							stderr || stdout || `Process exited with code ${code}`;
						outputChannel.appendLine(
							`\n❌ ${messages.failureOutputPrefix} with code ${code}`,
						);

						if (isCommandNotFoundError(errorMessage)) {
							showGitScNotFoundMessage();
						} else {
							vscode.window.showErrorMessage(
								`${messages.failureNotificationPrefix}: ${errorMessage.substring(0, 100)}`,
							);
						}
						rejectOnce(new Error(errorMessage));
					}
				});

				process.on("error", (err: Error) => {
					// 既に close / cancel 等で確定済みの場合は何もしない
					if (settled) {
						return;
					}
					if (isCancelled) {
						resolveOnce();
						return;
					}

					outputChannel.appendLine(
						`\n❌ Failed to start git-sc: ${err.message}`,
					);

					if (err.message.includes("ENOENT")) {
						showGitScNotFoundMessage();
					} else {
						vscode.window.showErrorMessage(
							`Failed to run git-sc: ${err.message}`,
						);
					}
					rejectOnce(err);
				});

				token.onCancellationRequested(() => {
					if (isCancelled) {
						return;
					}
					isCancelled = true;
					terminateProcessForCancellation(process, outputChannel);
					outputChannel.appendLine(`\n${messages.cancellationOutputLine}`);
					// resolveOnce() はここでは呼ばない。close イベントで
					// プロセス (および POSIX ではプロセスグループ) の終了を確認してから
					// resolve することで、終了未確定のまま VS Code に成功扱いされるのを避ける。
					//
					// SIGTERM を `trap "" TERM` 等で無視するプロセスに備え、POSIX では
					// 一定時間後に SIGKILL へ昇格してプロセスグループを強制終了する。
					// Windows は taskkill /F が既に強制終了相当なので追加昇格は不要。
					if (isPosix) {
						forceKillTimer = setTimeout(() => {
							if (!settled) {
								outputChannel.appendLine(
									"\n⚠️ git-sc did not exit after SIGTERM; sending SIGKILL",
								);
								terminateProcessForCancellation(
									process,
									outputChannel,
									"SIGKILL",
								);
							}
						}, 5000);
					}
				});
			});
		},
	);
}
