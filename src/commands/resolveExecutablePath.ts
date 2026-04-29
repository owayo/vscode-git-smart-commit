import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * PATH 環境変数を走査して指定コマンドの絶対パスを返す。
 *
 * Windows の `CreateProcess` は bare command を起動する際にカレントディレクトリを
 * 検索パスに含めるため、悪意あるリポジトリ直下の `git.exe` / `git-sc.cmd` を
 * 先に解決してしまう (cwd ハイジャック) リスクがある。
 * この関数はカレントディレクトリ参照 (`""` / `"."`) を明示的に除外して PATH のみ走査する。
 *
 * POSIX の `execvp` はカレントディレクトリを含めないため呼び出し不要。
 *
 * @returns 解決できた絶対パス、見つからない場合は null
 */
export function resolveExecutableOnPath(name: string): string | null {
	if (globalThis.process.platform !== "win32") {
		// POSIX は libc の execvp に PATH 探索を委ね、カレントディレクトリは含まれない
		return null;
	}

	const pathDirs = (globalThis.process.env.PATH ?? "").split(path.delimiter);
	const pathExts = (globalThis.process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
		.split(";")
		.map((ext) => ext.trim())
		.filter(Boolean);

	for (const rawDir of pathDirs) {
		const dir = rawDir.trim();
		// 空文字列とカレントディレクトリ参照を明示的に除外
		if (!dir || dir === "." || dir === "./" || dir === ".\\") {
			continue;
		}

		// PATHEXT 順で拡張子付き候補を確認
		for (const ext of pathExts) {
			const candidate = path.join(dir, name + ext);
			if (existsSync(candidate)) {
				return candidate;
			}
		}

		// name 自体が拡張子を含むケース
		const direct = path.join(dir, name);
		if (existsSync(direct)) {
			return direct;
		}
	}

	return null;
}

/**
 * `child_process.spawn` で安全に実行ファイルを起動するための
 * コマンドパスとシェル指定を返す。
 *
 * - POSIX: bare command を返す。`shell: false` で起動でき、`execvp` の PATH 探索は
 *   カレントディレクトリを含まないため安全。
 * - Windows: PATH 走査で絶対パスを解決して bare command 起動時の cwd ハイジャックを回避する。
 *   `.cmd` / `.bat` は CVE-2024-27980 対策で `shell: true` が必須、それ以外（`.exe` 等）は
 *   `shell: false` で直接起動できる。
 *
 * 解決できなかった場合は bare command + `shell: true` をフォールバックとして返す
 * （その場合は spawn 時に ENOENT で error イベントが発火する想定）。
 */
export function resolveSpawnCommand(name: string): {
	command: string;
	useShell: boolean;
} {
	if (globalThis.process.platform !== "win32") {
		return { command: name, useShell: false };
	}

	const resolved = resolveExecutableOnPath(name);
	if (!resolved) {
		// 解決失敗時はフォールバック (cwd ハイジャックリスクは残るが、
		// 通常はそもそも実行ファイルが存在せず ENOENT で失敗する)
		return { command: name, useShell: true };
	}

	const lower = resolved.toLowerCase();
	const useShell = lower.endsWith(".cmd") || lower.endsWith(".bat");
	return { command: resolved, useShell };
}
