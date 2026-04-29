import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * PATH 環境変数を走査して指定コマンドの絶対パスを返す。
 *
 * Windows の `CreateProcess` は bare command を起動する際にカレントディレクトリを
 * 検索パスに含めるため、悪意あるリポジトリ直下の `git.exe` / `git-sc.cmd` を
 * 先に解決してしまう (cwd ハイジャック) リスクがある。
 * この関数は PATH 要素のうち絶対パスのみを許容し、空文字列・カレントディレクトリ参照・
 * `.\tools` のような相対パスは全て除外する。
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

	// Windows のパス区切りに準拠（POSIX 上で実行されるテスト含めセパレータを ";" に固定）
	const pathDirs = (globalThis.process.env.PATH ?? "").split(";");
	const pathExts = (globalThis.process.env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
		.split(";")
		.map((ext) => ext.trim())
		.filter(Boolean);

	for (const rawDir of pathDirs) {
		const dir = rawDir.trim();
		// 絶対パスのみ許可する（空文字列・"."・"./"・".\\"・"bin"・".\tools"・"C:tools" 等は全て除外）。
		// 相対要素を許すと Windows の `CreateProcess` がそれをカレントディレクトリ相対として
		// 解決し、`spawn(..., { cwd: workspaceRoot })` と合わさって repo 配下のバイナリが
		// 起動する余地を残してしまうため、ここで完全に弾く。
		if (!dir || !path.win32.isAbsolute(dir)) {
			continue;
		}

		// PATHEXT 順で拡張子付き候補を確認（`path.win32.join` で Windows 形式を維持）
		for (const ext of pathExts) {
			const candidate = path.win32.join(dir, name + ext);
			if (existsSync(candidate)) {
				return candidate;
			}
		}

		// name 自体が拡張子を含むケース
		const direct = path.win32.join(dir, name);
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
 * Windows で PATH 上に解決できなかった場合は `null` を返す。
 * 呼び出し側はこれを受けて未検出ダイアログ等にフォールバックすること。
 * （bare command + `shell: true` でフォールバックすると cwd ハイジャックが復活するため使わない）
 */
export function resolveSpawnCommand(name: string): {
	command: string;
	useShell: boolean;
} | null {
	if (globalThis.process.platform !== "win32") {
		return { command: name, useShell: false };
	}

	const resolved = resolveExecutableOnPath(name);
	if (!resolved) {
		// 安全な絶対パスが得られないため、呼び出し側で未検出として扱う
		return null;
	}

	const lower = resolved.toLowerCase();
	const useShell = lower.endsWith(".cmd") || lower.endsWith(".bat");
	return { command: resolved, useShell };
}
