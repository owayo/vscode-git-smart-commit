import type { ChildProcess } from "node:child_process";
import { spawn } from "child_process";
import * as vscode from "vscode";
import { isCommandNotFoundError } from "./isCommandNotFoundError";
import { resolveSpawnCommand } from "./resolveExecutablePath";
import { terminateProcessForCancellation } from "./terminateProcessForCancellation";

const GIT_SC_INSTALLATION_URL =
	"https://github.com/owayo/git-smart-commit#installation";

/** キャンセル後にプロセスグループの消滅を確認するポーリング間隔 (ms) */
const PROCESS_GROUP_EXIT_POLL_INTERVAL_MS = 50;
/**
 * プロセスグループ消滅待ちの上限 (ms)。SIGKILL 昇格 (キャンセルから 5 秒) の後も
 * さらに猶予を持たせた値。SIGKILL でも消えない異常系 (uninterruptible sleep 等) で
 * 進捗表示が永久に残らないよう、超過時は警告を出して resolve する。
 */
const PROCESS_GROUP_EXIT_WAIT_LIMIT_MS = 10_000;

/**
 * 実行中の git-sc 子プロセスと、その「拡張停止時の終了ハンドラ」の対応表。
 * spawn 後に登録し、`close` / `error` で除去する。拡張機能の deactivate
 * (VS Code reload / 終了 / 拡張停止) 時に {@link terminateActiveGitScProcesses}
 * から各ハンドラを呼び、取り残しを防ぐ。
 */
const activeGitScProcesses = new Map<ChildProcess, () => void>();

/**
 * 現在実行中の git-sc 子プロセスをすべて終了させる。
 *
 * 子プロセスはキャンセル時にしか kill されないため、`deactivate()` から本関数を呼ばないと
 * VS Code の reload / 終了 / 拡張停止のタイミングで実行中の `git-sc` が孤児として残る。
 * 特に POSIX では `detached: true` で起動しており親プロセス終了では連動停止しないため、
 * プロセスグループごと終了させる必要がある。
 *
 * 各プロセスの終了ハンドラは内部で `isCancelled` を立ててから終了させる。これにより
 * 終了に伴う `close` イベントが「キャンセル」として扱われ、拡張停止時に誤った成功/失敗
 * 通知や `git.refresh` が走るのを防ぐ。終了シグナルはグレースフルな SIGTERM (Windows は
 * `taskkill /T /F`) とする。git の操作中断による破損リスクと、VS Code shutdown のタイムアウトで
 * 確実には走らない SIGKILL タイマーを避けるためで、SIGTERM を無視するプロセスの強制終了は
 * 通常のユーザーキャンセル経路 (5 秒後 SIGKILL 昇格) に委ねる。
 */
export function terminateActiveGitScProcesses(
	outputChannel: vscode.OutputChannel,
): void {
	if (activeGitScProcesses.size > 0) {
		outputChannel.appendLine(
			`\n⚠️ Terminating ${activeGitScProcesses.size} running git-sc process(es) on shutdown`,
		);
	}
	for (const shutdown of activeGitScProcesses.values()) {
		shutdown();
	}
	activeGitScProcesses.clear();
}

/**
 * `git-sc` が PATH 上に見つからない場合に、インストール案内付きのエラー通知を表示する。
 */
function showGitScNotFoundMessage(outputChannel: vscode.OutputChannel): void {
	void Promise.resolve(
		vscode.window.showErrorMessage(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		),
	)
		.then(async (selection) => {
			if (selection !== "View Installation") {
				return;
			}
			// openExternal は Thenable<boolean> を返し、false は「オープンに失敗した」ことを示す。
			// reject だけでなく false 解決も失敗モードなので、握りつぶさず警告として記録する。
			const opened = await vscode.env.openExternal(
				vscode.Uri.parse(GIT_SC_INSTALLATION_URL),
			);
			if (opened === false) {
				outputChannel.appendLine(
					"\n⚠️ Failed to open installation guide: VS Code returned false",
				);
			}
		})
		.catch((error: unknown) => {
			const message = error instanceof Error ? error.message : String(error);
			outputChannel.appendLine(
				`\n⚠️ Failed to open installation guide: ${message}`,
			);
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
				let groupExitPollTimer: ReturnType<typeof setTimeout> | undefined;
				let groupExitWaitedMs = 0;

				const clearForceKillTimer = (): void => {
					if (forceKillTimer !== undefined) {
						clearTimeout(forceKillTimer);
						forceKillTimer = undefined;
					}
				};

				const clearGroupExitPollTimer = (): void => {
					if (groupExitPollTimer !== undefined) {
						clearTimeout(groupExitPollTimer);
						groupExitPollTimer = undefined;
					}
				};

				const resolveOnce = (): void => {
					if (!settled) {
						settled = true;
						clearForceKillTimer();
						clearGroupExitPollTimer();
						resolve();
					}
				};

				const rejectOnce = (error: Error): void => {
					if (!settled) {
						settled = true;
						clearForceKillTimer();
						clearGroupExitPollTimer();
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
				let resolved: ReturnType<typeof resolveSpawnCommand>;
				try {
					resolved = resolveSpawnCommand("git-sc", args);
				} catch (error) {
					// resolveSpawnCommand は安全に起動できない引数 (制御文字や cmd.exe が
					// 展開する `%` 等) で throw する。握り潰すと header だけ出て失敗理由が
					// 見えないため、明示的に通知してから reject する。
					const message =
						error instanceof Error ? error.message : String(error);
					outputChannel.appendLine(
						`\n❌ Cannot safely launch git-sc: ${message}`,
					);
					vscode.window.showErrorMessage(
						`Cannot safely launch git-sc: ${message.substring(0, 100)}`,
					);
					rejectOnce(error instanceof Error ? error : new Error(message));
					return;
				}
				if (!resolved) {
					// PATH に安全な絶対パスが見つからない場合は spawn せず、
					// インストール案内へフォールバックする (フォールバック起動は
					// cwd ハイジャックが残るため避ける)
					outputChannel.appendLine(
						"\n❌ git-sc not found in PATH. Aborting before unsafe spawn.",
					);
					showGitScNotFoundMessage(outputChannel);
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
				const forceShutdownTerminate = (): void => {
					if (settled) {
						return;
					}
					// ユーザーキャンセル直後の close/error 未達区間で deactivate が来た場合、
					// 通常の SIGTERM 完了待ちを続けると拡張ホスト終了時に昇格タイマーも失われる。
					// POSIX は即 SIGKILL へ昇格し、Windows は taskkill /T /F を再実行して
					// close 前のプロセスツリーを取り残さない。
					terminateProcessForCancellation(
						process,
						outputChannel,
						isPosix ? "SIGKILL" : "SIGTERM",
					);
				};
				// deactivate 時の後始末対象として登録する。close/error で除去する。
				// 終了ハンドラは isCancelled を立ててから終了させ、拡張停止時の close を
				// 「キャンセル」扱いにして誤った成功/失敗通知・git.refresh を防ぐ。
				const shutdownTerminate = (): void => {
					if (settled) {
						return;
					}
					if (isCancelled) {
						forceShutdownTerminate();
						return;
					}
					isCancelled = true;
					terminateProcessForCancellation(process, outputChannel);
				};
				activeGitScProcesses.set(process, shutdownTerminate);

				// 子プロセスのプロセスグループがまだ存在するかを signal 0 で確認する。
				// ESRCH はグループ消滅を意味する。EPERM 等は「存在するが操作不可」なので存続扱いにする。
				const isPosixProcessGroupAlive = (): boolean => {
					if (process.pid === undefined) {
						return false;
					}
					try {
						globalThis.process.kill(-process.pid, 0);
						return true;
					} catch (error) {
						return !(
							error instanceof Error &&
							(error as NodeJS.ErrnoException).code === "ESRCH"
						);
					}
				};

				// キャンセル時の close 後、プロセスグループ全体の消滅を確認してから resolve する。
				//
				// POSIX の close は「直接の子プロセスと stdio の終了」しか保証せず、stdio を
				// 継承しない孫プロセスが SIGTERM を無視して生き残るケースがある。ここで即
				// resolve すると resolveOnce が forceKillTimer をクリアし、5 秒後の SIGKILL
				// 昇格が走らないまま孫プロセスが孤児として残る。グループ消滅をポーリングで
				// 確認する間は settled にならないため、SIGKILL 昇格タイマーが生きたまま
				// 残存プロセスを強制終了できる。SIGKILL でも消えない異常系では上限時間を
				// 超えた時点で警告を出して resolve し、進捗表示が永久に残るのを防ぐ。
				const waitForPosixProcessGroupExit = (): void => {
					if (settled) {
						return;
					}
					if (!isPosixProcessGroupAlive()) {
						activeGitScProcesses.delete(process);
						resolveOnce();
						return;
					}
					if (groupExitWaitedMs >= PROCESS_GROUP_EXIT_WAIT_LIMIT_MS) {
						outputChannel.appendLine(
							"\n⚠️ git-sc process group is still alive after cancellation; giving up waiting",
						);
						activeGitScProcesses.delete(process);
						resolveOnce();
						return;
					}
					groupExitWaitedMs += PROCESS_GROUP_EXIT_POLL_INTERVAL_MS;
					groupExitPollTimer = setTimeout(
						waitForPosixProcessGroupExit,
						PROCESS_GROUP_EXIT_POLL_INTERVAL_MS,
					);
				};

				// キャンセル済みの terminal イベント (close / error) から呼ぶ入口。
				// close / error ハンドラ冒頭で map から削除済みのため、ポーリング中に
				// deactivate が来ると残存グループへ何も送れず孫が孤児化する。そこで
				// 「残存グループを即 SIGKILL する」shutdown ハンドラへ差し替えて map に
				// 残し (グループ消滅確認後の resolve で削除される)、消滅確認を開始する。
				// close と error が連続発火してもポーリングを二重に開始しない。
				let groupExitWaitStarted = false;
				const beginCancelledPosixGroupExitWait = (): void => {
					if (groupExitWaitStarted) {
						return;
					}
					groupExitWaitStarted = true;
					activeGitScProcesses.set(process, () => {
						// shutdown 時はグレースフル待ちをやめ、残存グループを即時強制終了する
						if (isPosixProcessGroupAlive()) {
							forceShutdownTerminate();
						}
					});
					waitForPosixProcessGroupExit();
				};

				let stdout = "";
				let stderr = "";

				// UTF-8 の複数バイト文字がチャンク境界で分割されても、StringDecoder に
				// 境界を保持させて U+FFFD への置換による文字化けを防ぐ。
				process.stdout.setEncoding("utf8");
				process.stderr.setEncoding("utf8");

				process.stdout.on("data", (data: string | Buffer) => {
					const text = typeof data === "string" ? data : data.toString("utf8");
					stdout += text;
					outputChannel.append(text);
				});

				process.stderr.on("data", (data: string | Buffer) => {
					const text = typeof data === "string" ? data : data.toString("utf8");
					stderr += text;
					outputChannel.append(text);
				});

				process.on("close", (code: number | null) => {
					// プロセス終了が確定したので後始末対象から除去する
					activeGitScProcesses.delete(process);
					// 既に error / cancel 等で確定済みの場合は何もしない
					// （POSIX では spawn 失敗時に error → close が連続発火するため、
					// UI 通知や outputChannel 出力の二重化を防ぐ）
					if (settled) {
						return;
					}
					if (isCancelled) {
						if (isPosix) {
							// 直接の子の close はプロセスグループ全体の消滅と同義ではない。
							// SIGTERM を無視する孫プロセスが残っている間は resolve せず、
							// グループ消滅 (または SIGKILL 昇格後の消滅) を確認してから resolve する。
							beginCancelledPosixGroupExitWait();
						} else {
							resolveOnce();
						}
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
							showGitScNotFoundMessage(outputChannel);
						} else {
							vscode.window.showErrorMessage(
								`${messages.failureNotificationPrefix}: ${errorMessage.substring(0, 100)}`,
							);
						}
						rejectOnce(new Error(errorMessage));
					}
				});

				process.on("error", (err: Error) => {
					// spawn 失敗等で終了が確定したので後始末対象から除去する
					activeGitScProcesses.delete(process);
					// 既に close / cancel 等で確定済みの場合は何もしない
					if (settled) {
						return;
					}
					if (isCancelled) {
						if (isPosix) {
							// キャンセル後の kill 失敗等で error が発火した場合も close と同様に
							// グループ消滅を確認してから resolve する。即 resolve すると
							// forceKillTimer がクリアされ SIGKILL 昇格が走らない
							// (spawn 失敗時は pid 未定義のため即 resolve に合流する)。
							beginCancelledPosixGroupExitWait();
						} else {
							resolveOnce();
						}
						return;
					}

					outputChannel.appendLine(
						`\n❌ Failed to start git-sc: ${err.message}`,
					);

					if (err.message.includes("ENOENT")) {
						showGitScNotFoundMessage(outputChannel);
					} else {
						vscode.window.showErrorMessage(
							`Failed to run git-sc: ${err.message}`,
						);
					}
					rejectOnce(err);
				});

				token.onCancellationRequested(() => {
					// `close` / `error` で resolveOnce / rejectOnce 済みのときは settled=true。
					// settled 後にキャンセル通知が遅れて到着するレースが VS Code UI 側で起こり得るが、
					// その場合は既に完了済みなので終了処理を再実行せず、誤った "cancelled" ログも出さない。
					if (isCancelled || settled) {
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
