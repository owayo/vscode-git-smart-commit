import { execFile } from "child_process";
import { resolveNativeExecutableOnPath } from "./resolveExecutablePath";

/**
 * Git の絶対パスを解決する。最新の PATH を使い、未検出時は起動失敗と同じ
 * `code: "ENOENT"` のエラーを投げて、呼び出し元の通知を統一する。
 */
export function resolveGitExecutable(): string {
	const gitCommand = resolveNativeExecutableOnPath("git");
	if (!gitCommand) {
		throw Object.assign(new Error("spawn git ENOENT"), { code: "ENOENT" });
	}
	return gitCommand;
}

/**
 * Git を非同期に実行し、標準出力を返す。
 *
 * execFileSync は Git の終了まで拡張ホストのイベントループを止める。Git 管理外のフォルダーが
 * 並ぶマルチルートでは起動の回数だけ待ちが積み上がり、応答しないファイルシステムでは
 * ほかの拡張の処理まで止まる。失敗時のメッセージは execFileSync と同じく
 * `Command failed: <コマンド>` と標準エラーから成り、標準出力・標準エラーもエラーに付ける。
 */
export function execGit(
	gitCommand: string,
	args: readonly string[],
	options: { readonly env?: NodeJS.ProcessEnv } = {},
): Promise<string> {
	return new Promise((resolve, reject) => {
		const child = execFile(
			gitCommand,
			[...args],
			{ encoding: "utf-8", ...options },
			(error, stdout, stderr) => {
				if (error) {
					reject(Object.assign(error, { stdout, stderr }));
					return;
				}
				resolve(stdout);
			},
		);
		// Git に標準入力を待たせない (execFileSync の stdin を ignore にしていたのと同じ扱い)
		child.stdin?.end();
	});
}
