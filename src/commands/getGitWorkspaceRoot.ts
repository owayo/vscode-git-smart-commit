import { execFileSync } from "child_process";
import type * as vscode from "vscode";

/** git rev-parse が「Git 管理外」として返すエラーかどうかを判定する */
function isNotGitRepositoryError(error: unknown): boolean {
	return error instanceof Error && /not a git repository/i.test(error.message);
}

export function getGitWorkspaceRoot(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
): string | null {
	for (const folder of workspaceFolders) {
		try {
			const workspaceRoot = execFileSync(
				"git",
				["rev-parse", "--show-toplevel"],
				{
					cwd: folder.uri.fsPath,
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
				},
			).trim();

			if (workspaceRoot.length > 0) {
				return workspaceRoot;
			}
		} catch (error) {
			if (isNotGitRepositoryError(error)) {
				// Git 管理外のワークスペースは候補から除外する
				continue;
			}
			// ENOENT（git 未インストール）や権限エラー等は呼び出し元に伝搬する
			throw error;
		}
	}

	return null;
}
