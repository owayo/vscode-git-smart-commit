// 「git-sc が PATH 上に見つからない」と判断するためのメッセージパターン集。
// 本拡張は spawn 前に `resolveSpawnCommand` で git-sc を絶対パスに解決し、
// 解決失敗時はそもそも spawn しないため、起動済みプロセスが返す終了コードは
// git-sc 自身の異常終了として扱う必要がある。
// POSIX の 127 はもとよりシェル経由でないと未検出を意味しないが、
// Windows の 9009 も `resolveSpawnCommand` 通過後はもはや「git-sc 未検出」を意味せず、
// `git-sc.cmd` 内部の依存コマンド未検出などで返り得る。
// したがって未検出判定はメッセージパターン一致時のみ行う。
const COMMAND_NOT_FOUND_PATTERNS = [
	/\bgit-sc:\s*command not found\b/,
	/\bgit-sc:\s*not found\b/,
	/\bcommand not found:\s*git-sc\b/,
	/['"]?git-sc(?:\.(?:cmd|bat|exe))?['"]?\s+is not recognized as an internal or external command\b/,
	/the term ['"]?git-sc(?:\.(?:cmd|bat|exe))?['"]? is not recognized as the name of (a )?cmdlet\b/,
];

export function isCommandNotFoundError(errorMessage: string): boolean {
	const normalizedMessage = errorMessage.toLowerCase();
	return COMMAND_NOT_FOUND_PATTERNS.some((pattern) =>
		pattern.test(normalizedMessage),
	);
}
