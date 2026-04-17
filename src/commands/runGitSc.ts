import { spawn } from "child_process";
import * as vscode from "vscode";
import { getGitWorkspaceRoot } from "./getGitWorkspaceRoot";
import { isCommandNotFoundError } from "./isCommandNotFoundError";

export interface GitScOptions {
	stageAll?: boolean;
	autoConfirm?: boolean;
	includeBody?: boolean;
}

const GIT_SC_INSTALLATION_URL =
	"https://github.com/owayo/git-smart-commit#installation";

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

export async function runGitSc(
	outputChannel: vscode.OutputChannel,
	options: GitScOptions = {},
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

	const config = vscode.workspace.getConfiguration("gitSmartCommit");

	// 実行コマンドの引数を組み立てる
	const args: string[] = [];

	if (options.stageAll) {
		args.push("-a");
	}

	if (options.includeBody ?? config.get<boolean>("includeBody", false)) {
		args.push("-b");
	}

	if (options.autoConfirm ?? config.get<boolean>("autoConfirm", false)) {
		args.push("-y");
	}

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

				progress.report({ message: "Generating commit message..." });

				// shell: true だと中継シェルだけが kill 対象となり、
				// 子プロセスの git-sc がキャンセル後も生き残るため shell: false を使う。
				// Windows では .cmd ラッパー経由のため明示的に拡張子を付与する。
				const command =
					globalThis.process.platform === "win32" ? "git-sc.cmd" : "git-sc";
				const process = spawn(command, args, {
					cwd: workspaceRoot,
					shell: false,
					env: { ...globalThis.process.env, FORCE_COLOR: "0" },
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
					if (isCancelled) {
						resolveOnce();
						return;
					}

					if (code === 0) {
						outputChannel.appendLine(`\n✅ git-sc completed successfully`);
						vscode.window.showInformationMessage("Git Smart Commit completed!");

						// Git 拡張の状態表示を更新
						vscode.commands.executeCommand("git.refresh");
						resolveOnce();
					} else {
						const errorMessage =
							stderr || stdout || `Process exited with code ${code}`;
						outputChannel.appendLine(`\n❌ git-sc failed with code ${code}`);

						if (isCommandNotFoundError(code, errorMessage)) {
							showGitScNotFoundMessage();
						} else {
							vscode.window.showErrorMessage(
								`Git Smart Commit failed: ${errorMessage.substring(0, 100)}`,
							);
						}
						rejectOnce(new Error(errorMessage));
					}
				});

				process.on("error", (err: Error) => {
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
					process.kill("SIGTERM");
					outputChannel.appendLine("\n⚠️ git-sc cancelled by user");
					resolveOnce();
				});
			});
		},
	);
}
