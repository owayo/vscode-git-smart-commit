import { resolveNativeExecutableOnPath } from "./resolveExecutablePath";

/** Git の絶対パスを解決する。最新の PATH を使い、未検出時の通知用エラーを統一する。 */
export function resolveGitExecutable(): string {
	const gitCommand = resolveNativeExecutableOnPath("git");
	if (!gitCommand) {
		throw new Error("spawn git ENOENT");
	}
	return gitCommand;
}
