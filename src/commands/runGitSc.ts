import * as vscode from "vscode";
import { getGitWorkspaceRoot } from "./getGitWorkspaceRoot";
import { spawnGitScWithProgress } from "./spawnGitScProcess";

export interface GitScOptions {
	stageAll?: boolean;
	autoConfirm?: boolean;
	includeBody?: boolean;
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

	// spawn / 進捗表示 / キャンセル処理は reword フローと共通のヘルパーに委譲し、
	// commit フロー固有の表示文言だけを渡す。
	return spawnGitScWithProgress({
		outputChannel,
		workspaceRoot,
		args,
		messages: {
			progressMessage: "Generating commit message...",
			successOutputLine: "✅ git-sc completed successfully",
			successNotification: "Git Smart Commit completed!",
			failureOutputPrefix: "git-sc failed",
			failureNotificationPrefix: "Git Smart Commit failed",
			cancellationOutputLine: "⚠️ git-sc cancelled by user",
		},
	});
}
