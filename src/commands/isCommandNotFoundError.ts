// 「git-sc が PATH 上に見つからない」と判断するためのメッセージパターン集。
// 本拡張は spawn 前に `resolveSpawnCommand` で git-sc を絶対パスに解決し、
// 解決失敗時はそもそも spawn しないため、起動済みプロセスが返す終了コードは
// git-sc 自身の異常終了として扱う必要がある。
// POSIX の 127 はもとよりシェル経由でないと未検出を意味しないが、
// Windows の 9009 も `resolveSpawnCommand` 通過後はもはや「git-sc 未検出」を意味せず、
// `git-sc.cmd` 内部の依存コマンド未検出などで返り得る。
// したがって未検出判定はメッセージパターン一致時のみ行う。
//
// `git-sc` はハイフンを含むため、`\b` (単語境界) では `-` を非単語文字＝境界とみなし、
// `my-git-sc` や `git-sc-helper` のような別コマンド名の部分文字列にも誤マッチしてしまう。
// その結果、git-sc 自身は起動済みで内部処理が別コマンド未検出により異常終了したケースを
// 「git-sc 未検出」と誤判定し、誤ったインストール案内ダイアログを表示する恐れがあった。
// そこで前後に単語文字・ハイフンが続かないことを lookaround で明示し、git-sc 自身の報告
// だけを検出する。
const GIT_SC = String.raw`(?<![\w-])git-sc(?![\w-])`;
// Windows の cmd.exe / PowerShell は拡張子付き (`git-sc.cmd` 等) で報告することがある。
const GIT_SC_WITH_EXT = String.raw`(?<![\w-])git-sc(?:\.(?:cmd|bat|exe))?(?![\w-])`;

const COMMAND_NOT_FOUND_PATTERNS = [
	new RegExp(`${GIT_SC}:\\s*command not found\\b`),
	new RegExp(`${GIT_SC}:\\s*not found\\b`),
	new RegExp(`\\bcommand not found:\\s*${GIT_SC}`),
	new RegExp(
		`['"]?${GIT_SC_WITH_EXT}['"]?\\s+is not recognized as an internal or external command\\b`,
	),
	new RegExp(
		`the term ['"]?${GIT_SC_WITH_EXT}['"]? is not recognized as the name of (a )?cmdlet\\b`,
	),
];

export function isCommandNotFoundError(errorMessage: string): boolean {
	const normalizedMessage = errorMessage.toLowerCase();
	return COMMAND_NOT_FOUND_PATTERNS.some((pattern) =>
		pattern.test(normalizedMessage),
	);
}
