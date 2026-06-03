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

/**
 * `git rev-parse --show-toplevel` が末尾に付ける行終端だけを除去する。
 *
 * 単純な `/\r?\n$/` だと、POSIX で実在し得るパス末尾の CR (`\r`) まで巻き込んで削ってしまう。
 * POSIX のファイル/ディレクトリ名は `/` と NUL 以外を許容するため `…/repo\r` のようなパスが
 * 有効で、git はこれに LF だけを付けて `…/repo\r\n` を返す。これを CRLF とみなして 2 文字削ると
 * 本来の末尾 `\r` が失われ、誤った（存在しない、または別の）cwd で `git-sc` を spawn してしまう。
 * そこで POSIX では LF を 1 文字だけ削り、Windows でのみ CRLF (`\r\n`) を改行として 2 文字削る
 * (Windows のパスには制御文字 `\r` を含められないため、Windows の `\r\n` は常に改行とみなせる)。
 */
function stripGitTrailingLineTerminator(output: string): string {
	if (!output.endsWith("\n")) {
		return output;
	}
	if (globalThis.process.platform === "win32" && output.endsWith("\r\n")) {
		return output.slice(0, -2);
	}
	return output.slice(0, -1);
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
			// Git が末尾に付ける行終端だけを除去し、実在パス末尾の空白や CR は保持する。
			const workspaceRoot = stripGitTrailingLineTerminator(
				execFileSync(
					gitCommand,
					["-C", folder.uri.fsPath, "rev-parse", "--show-toplevel"],
					{
						encoding: "utf-8",
						stdio: ["ignore", "pipe", "pipe"],
						env: getGitEnglishEnv(),
					},
				),
			);

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
