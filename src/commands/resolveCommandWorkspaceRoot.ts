import * as vscode from "vscode";
import { getGitWorkspaceRoot } from "./getGitWorkspaceRoot";

/**
 * Git の実行失敗を通知する。Git 自体が見つからない (ENOENT) 場合は導入を案内し、
 * それ以外は `<prefix>: <エラーの先頭 100 文字>` を表示する。
 */
export function showGitCommandError(prefix: string, error: unknown): void {
	const message = error instanceof Error ? error.message : String(error);
	if (message.includes("ENOENT")) {
		vscode.window.showErrorMessage(
			"Git command not found. Please install Git and ensure it's in your PATH.",
		);
	} else {
		vscode.window.showErrorMessage(`${prefix}: ${message.substring(0, 100)}`);
	}
}

/**
 * コマンドの実行対象とする Git リポジトリのルートを解決する。
 *
 * SCM から対象が渡された場合はその対象だけを、無い場合は開いているワークスペースフォルダーを
 * 先頭から調べる。commit と reword の両フローで同じ判定と通知を使うため、ここに集約する。
 * 解決できなかった場合は理由を通知して null を返す。
 */
export async function resolveCommandWorkspaceRoot(
	targetUri?: vscode.Uri,
): Promise<string | null> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!targetUri && (!workspaceFolders || workspaceFolders.length === 0)) {
		vscode.window.showErrorMessage("No workspace folder open");
		return null;
	}

	let workspaceRoot: string | null;
	try {
		workspaceRoot = await getGitWorkspaceRoot(
			workspaceFolders ?? [],
			targetUri,
		);
	} catch (error) {
		showGitCommandError("Failed to detect Git repository", error);
		return null;
	}
	if (!workspaceRoot) {
		vscode.window.showErrorMessage("No Git repository found in open workspace");
		return null;
	}
	return workspaceRoot;
}
