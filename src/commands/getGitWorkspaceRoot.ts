import { execFileSync } from "child_process";
import type * as vscode from "vscode";

/** git rev-parse が「Git 管理外」として返すエラーかどうかを判定する */
function isNotGitRepositoryError(error: unknown): boolean {
	return error instanceof Error && /not a git repository/i.test(error.message);
}

/** Git メッセージを英語に固定しつつ、最新の環境変数を毎回取り込む */
function getGitEnglishEnv() {
	return {
		...globalThis.process.env,
		LC_ALL: "C",
		LANG: "C",
	};
}

export function getGitWorkspaceRoot(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
): string | null {
	for (const folder of workspaceFolders) {
		try {
			// `-C <dir>` で作業ディレクトリを git に直接指定する。
			// `cwd` で渡すと Windows の `CreateProcess` がカレントディレクトリを
			// 実行ファイル探索パスに含め、悪意ある repo 直下の `git.exe` を
			// 優先実行してしまう (cwd ハイジャック) リスクがあるため避ける。
			const workspaceRoot = execFileSync(
				"git",
				["-C", folder.uri.fsPath, "rev-parse", "--show-toplevel"],
				{
					encoding: "utf-8",
					stdio: ["ignore", "pipe", "pipe"],
					env: getGitEnglishEnv(),
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
