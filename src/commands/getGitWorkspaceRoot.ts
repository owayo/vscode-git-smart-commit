import { execFileSync } from "child_process";
import type * as vscode from "vscode";

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
					stdio: ["ignore", "pipe", "ignore"],
				},
			).trim();

			if (workspaceRoot.length > 0) {
				return workspaceRoot;
			}
		} catch {
			// Git 管理外のワークスペースは候補から除外する
		}
	}

	return null;
}
