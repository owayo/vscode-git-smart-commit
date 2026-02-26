const COMMAND_NOT_FOUND_EXIT_CODES = new Set([127, 9009]);
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
