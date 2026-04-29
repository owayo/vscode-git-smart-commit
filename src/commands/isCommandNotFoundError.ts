// Windows の cmd.exe が「コマンド未検出」を示す終了コード。
// POSIX のシェルが返す 127 は、シェル経由で実行された場合に限り未検出を意味するが、
// 本拡張は POSIX で `shell: false` で git-sc を spawn しているため、
// `close` で来る 127 は起動済み git-sc 自身の終了コードであり、未検出と判定してはならない。
// （未検出は `error` イベント (ENOENT) で検知する）
const COMMAND_NOT_FOUND_EXIT_CODES = new Set([9009]);
const COMMAND_NOT_FOUND_PATTERNS = [
	/\bgit-sc:\s*command not found\b/,
	/\bgit-sc:\s*not found\b/,
	/\bcommand not found:\s*git-sc\b/,
	/['"]?git-sc['"]?\s+is not recognized as an internal or external command\b/,
	/the term ['"]?git-sc['"]? is not recognized as the name of (a )?cmdlet\b/,
];

export function isCommandNotFoundError(
	code: number | null,
	errorMessage: string,
): boolean {
	if (code !== null && COMMAND_NOT_FOUND_EXIT_CODES.has(code)) {
		return true;
	}

	const normalizedMessage = errorMessage.toLowerCase();
	return COMMAND_NOT_FOUND_PATTERNS.some((pattern) =>
		pattern.test(normalizedMessage),
	);
}
