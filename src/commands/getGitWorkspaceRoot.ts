import { execFileSync } from "child_process";
import type * as vscode from "vscode";
import { resolveNativeExecutableOnPath } from "./resolveExecutablePath";

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

function resolveGitExecutable(): string {
	const gitCommand = resolveNativeExecutableOnPath("git");
	if (!gitCommand) {
		throw new Error("spawn git ENOENT");
	}
	return gitCommand;
}

export function getGitWorkspaceRoot(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
): string | null {
	let gitCommand: string | undefined;

	for (const folder of workspaceFolders) {
		try {
			gitCommand ??= resolveGitExecutable();
			// git 実行ファイルは絶対パスで起動し、対象リポジトリは `-C <dir>` で渡す。
			// bare command や `cwd` 指定に依存すると、Windows の実行ファイル探索順により
			// カレントディレクトリ配下の偽 `git.exe` を拾う余地があるため避ける。
			const workspaceRoot = execFileSync(
				gitCommand,
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
