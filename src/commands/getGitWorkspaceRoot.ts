import { stat } from "node:fs/promises";
import type * as vscode from "vscode";
import { execGit, resolveGitExecutable } from "./gitExecutable";

/**
 * git rev-parse が「Git 管理外」として返すエラーかどうかを判定する。
 *
 * エラーメッセージには `Command failed: git -C <フォルダー> ...` の行も入るため、フォルダー名に
 * 同じ文言を含むだけの別のエラー (所有権の拒否など) を管理外と取り違え、次の候補のリポジトリへ
 * 進んでしまわないよう、Git の診断の行頭 (`fatal: not a git repository`) だけを照合する。
 */
function isNotGitRepositoryError(error: unknown): boolean {
	return (
		error instanceof Error &&
		/^fatal: not a git repository/im.test(error.message)
	);
}

/** Git メッセージを英語に固定しつつ、最新の環境変数を毎回取り込む */
function getGitEnglishEnv() {
	return {
		...globalThis.process.env,
		LC_ALL: "C",
		LANG: "C",
	};
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

/**
 * 候補がディレクトリとして存在するかを調べる。削除済み (ENOENT) と、途中の要素が
 * ファイルになったパス (ENOTDIR) は存在しないものとして扱い、権限エラー等は伝える。
 */
async function isExistingDirectory(fsPath: string): Promise<boolean> {
	try {
		return (await stat(fsPath)).isDirectory();
	} catch (error) {
		const code = (error as NodeJS.ErrnoException | undefined)?.code;
		if (code === "ENOENT" || code === "ENOTDIR") {
			return false;
		}
		throw error;
	}
}

export async function getGitWorkspaceRoot(
	workspaceFolders: readonly vscode.WorkspaceFolder[],
	targetUri?: vscode.Uri,
): Promise<string | null> {
	let gitCommand: string | undefined;
	// SCM から明示された対象が無効でも、別のリポジトリへ切り替えてコミットしない。
	const candidates = targetUri ? [{ uri: targetUri }] : workspaceFolders;

	// 候補は先頭から 1 つずつ調べ、最初に見つかったリポジトリで止める。並列に起動すると、
	// 先頭がリポジトリでも残りの候補まで Git を起動し、後ろの候補のエラーで止まる余地も生じる。
	for (const folder of candidates) {
		// 削除済み・ファイル化した候補を除外し、後続の正常なリポジトリを検出する。
		// URI の scheme は限定せず、リモート拡張ホストで参照できる fsPath も扱う。
		if (!(await isExistingDirectory(folder.uri.fsPath))) {
			continue;
		}
		try {
			gitCommand ??= resolveGitExecutable();
			// git 実行ファイルは絶対パスで起動し、対象リポジトリは `-C <dir>` で渡す。
			// bare command や `cwd` 指定に依存すると、Windows の実行ファイル探索順により
			// カレントディレクトリ配下の偽 `git.exe` を拾う余地があるため避ける。
			// Git が末尾に付ける行終端だけを除去し、実在パス末尾の空白や CR は保持する。
			const workspaceRoot = stripGitTrailingLineTerminator(
				await execGit(
					gitCommand,
					["-C", folder.uri.fsPath, "rev-parse", "--show-toplevel"],
					{ env: getGitEnglishEnv() },
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
