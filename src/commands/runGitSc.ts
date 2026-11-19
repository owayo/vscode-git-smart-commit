import * as vscode from "vscode";
import { resolveCommandWorkspaceRoot } from "./resolveCommandWorkspaceRoot";
import { spawnGitScWithProgress } from "./spawnGitScProcess";

export interface GitScOptions {
	stageAll?: boolean;
	autoConfirm?: boolean;
	includeBody?: boolean;
}

export async function runGitSc(
	outputChannel: vscode.OutputChannel,
	options: GitScOptions = {},
	targetUri?: vscode.Uri,
): Promise<void> {
	const workspaceRoot = await resolveCommandWorkspaceRoot(targetUri);
	if (!workspaceRoot) {
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
