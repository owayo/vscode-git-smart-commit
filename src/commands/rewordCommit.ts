import { execFileSync, spawn } from "child_process";
import * as vscode from "vscode";
import { getGitWorkspaceRoot } from "./getGitWorkspaceRoot";
import { isCommandNotFoundError } from "./isCommandNotFoundError";
import { resolveSpawnCommand } from "./resolveExecutablePath";
import { terminateProcessForCancellation } from "./terminateProcessForCancellation";

export interface CommitInfo {
	index: number;
	hash: string;
	message: string;
	date: string;
	author: string;
}

const GIT_SC_INSTALLATION_URL =
	"https://github.com/owayo/git-smart-commit#installation";
const GIT_LOG_SEPARATOR = "\x00";

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

function getCommitCount(workspaceRoot: string): number | null {
	try {
		// `-C <dir>` で作業ディレクトリを git に渡すことで、
		// Windows での cwd ハイジャック (悪意ある repo 直下の git.exe 優先実行) を防ぐ
		const output = execFileSync(
			"git",
			["-C", workspaceRoot, "rev-list", "--count", "--all"],
			{
				encoding: "utf-8",
			},
		).trim();
		const count = Number.parseInt(output, 10);
		return Number.isNaN(count) ? null : count;
	} catch {
		return null;
	}
}

export function getRecentCommits(
	workspaceRoot: string,
	limit: number = 10,
): CommitInfo[] {
	const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
	let output: string;
	try {
		// `-C <dir>` で作業ディレクトリを git に渡すことで、
		// Windows での cwd ハイジャックを防ぐ
		output = execFileSync(
			"git",
			[
				"-C",
				workspaceRoot,
				"log",
				"--format=format:%h%x00%s%x00%cr%x00%an%x00",
				"-n",
				String(safeLimit),
			],
			{
				encoding: "utf-8",
			},
		);
	} catch (error) {
		if (getCommitCount(workspaceRoot) === 0) {
			return [];
		}
		throw error;
	}

	const fields = output.split(GIT_LOG_SEPARATOR);
	const commits: CommitInfo[] = [];

	for (
		let index = 0, fieldIndex = 0;
		fieldIndex + 3 < fields.length;
		index += 1
	) {
		// format: はコミット間に改行セパレータを挿入するため、
		// 2番目以降のハッシュ先頭に改行が混入する → 先頭の改行のみ除去
		const hash = (fields[fieldIndex] ?? "").replace(/^\n/, "");
		const message = fields[fieldIndex + 1] ?? "";
		const date = fields[fieldIndex + 2] ?? "";
		const author = fields[fieldIndex + 3] ?? "";
		fieldIndex += 4;

		commits.push({
			index: index + 1, // git-sc --reword 向けの 1 始まりインデックス
			hash,
			message,
			date,
			author,
		});
	}

	return commits;
}

export async function rewordCommit(
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("No workspace folder open");
		return;
	}

	let workspaceRoot: string | null;
	try {
		workspaceRoot = getGitWorkspaceRoot(workspaceFolders);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("ENOENT")) {
			vscode.window.showErrorMessage(
				"Git command not found. Please install Git and ensure it's in your PATH.",
			);
		} else {
			vscode.window.showErrorMessage(
				`Failed to detect Git repository: ${message.substring(0, 100)}`,
			);
		}
		return;
	}
	if (!workspaceRoot) {
		vscode.window.showErrorMessage("No Git repository found in open workspace");
		return;
	}

	// 直近コミットを取得
	let commits: CommitInfo[];
	try {
		commits = getRecentCommits(workspaceRoot, 15);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(
			`\n❌ Failed to load commit history: ${errorMessage}`,
		);

		if (errorMessage.includes("ENOENT")) {
			vscode.window.showErrorMessage(
				"Git command not found. Please install Git and ensure it's in your PATH.",
			);
		} else {
			vscode.window.showErrorMessage(
				`Failed to load commit history: ${errorMessage.substring(0, 100)}`,
			);
		}
		return;
	}

	if (commits.length === 0) {
		vscode.window.showWarningMessage("No commits found in this repository");
		return;
	}

	// QuickPick の候補を作成
	const items: Array<vscode.QuickPickItem & { commit: CommitInfo }> =
		commits.map((commit) => ({
			label: `$(git-commit) ${commit.message}`,
			description: `${commit.hash} • ${commit.date}`,
			detail: `${commit.index - 1} commit(s) ago • by ${commit.author}`,
			commit,
		}));

	// QuickPick を表示
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: "Select a commit to reword",
		title: "Git Smart Commit: Reword",
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!selected) {
		return; // ユーザーがキャンセル
	}

	const commit = selected.commit;

	// 選択内容を確認
	const confirm = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: `Reword commit "${commit.message.substring(0, 50)}${commit.message.length > 50 ? "..." : ""}"?`,
		title: "Confirm Reword",
	});

	if (confirm !== "Yes") {
		return;
	}

	// 選択したコミットハッシュで git-sc --reword を実行
	await runGitScReword(outputChannel, workspaceRoot, commit.hash);
}

async function runGitScReword(
	outputChannel: vscode.OutputChannel,
	workspaceRoot: string,
	hash: string,
): Promise<void> {
	outputChannel.show(true);
	outputChannel.appendLine(`\n${"=".repeat(50)}`);
	outputChannel.appendLine(
		`[${new Date().toLocaleTimeString()}] Running: git-sc --reword ${hash} -y`,
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

				const resolveOnce = (): void => {
					if (!settled) {
						settled = true;
						resolve();
					}
				};

				const rejectOnce = (error: Error): void => {
					if (!settled) {
						settled = true;
						reject(error);
					}
				};

				progress.report({ message: `Rewording commit ${hash}...` });

				// POSIX では shell: false で起動することで process.kill が
				// 中継シェルではなく実際の git-sc プロセスへ届くようにする。
				// Windows では PATH を走査して絶対パスで起動することで cwd ハイジャック
				// (悪意ある repo 直下の git-sc.cmd を優先実行する攻撃) を防ぎ、
				// .cmd/.bat の場合のみ Node.js の CVE-2024-27980 対策で shell: true を使う。
				// shell: true 利用時はキャンセルで taskkill /T /F により
				// 中継シェルもろともプロセスツリーを終了させる。
				const { command, useShell } = resolveSpawnCommand("git-sc");
				const process = spawn(command, ["--reword", hash, "-y"], {
					cwd: workspaceRoot,
					shell: useShell,
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
						outputChannel.appendLine(`\n✅ Reword completed successfully`);
						vscode.window.showInformationMessage(
							"Commit reworded successfully!",
						);
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
						outputChannel.appendLine(`\n❌ Reword failed with code ${code}`);
						if (isCommandNotFoundError(code, errorMessage)) {
							showGitScNotFoundMessage();
						} else {
							vscode.window.showErrorMessage(
								`Reword failed: ${errorMessage.substring(0, 100)}`,
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
					isCancelled = true;
					terminateProcessForCancellation(process, outputChannel);
					outputChannel.appendLine("\n⚠️ Reword cancelled by user");
					resolveOnce();
				});
			});
		},
	);
}
