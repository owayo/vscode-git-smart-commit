import { accessSync, constants, statSync } from "node:fs";
import * as path from "node:path";

function getPathEnvValue(): string {
	if (globalThis.process.env.PATH !== undefined) {
		return globalThis.process.env.PATH;
	}

	if (globalThis.process.platform !== "win32") {
		return "";
	}

	const pathKey = Object.keys(globalThis.process.env).find(
		(key) => key.toLowerCase() === "path",
	);
	return pathKey ? (globalThis.process.env[pathKey] ?? "") : "";
}

function getWindowsEnvValue(name: string): string {
	if (globalThis.process.env[name] !== undefined) {
		return globalThis.process.env[name] ?? "";
	}

	const envKey = Object.keys(globalThis.process.env).find(
		(key) => key.toLowerCase() === name.toLowerCase(),
	);
	return envKey ? (globalThis.process.env[envKey] ?? "") : "";
}

function isRegularFile(candidate: string): boolean {
	try {
		return statSync(candidate).isFile();
	} catch {
		return false;
	}
}

function isExecutableFile(candidate: string): boolean {
	if (!isRegularFile(candidate)) {
		return false;
	}

	try {
		accessSync(candidate, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

/**
 * PATH 環境変数を走査して指定コマンドの絶対パスを返す。
 *
 * Windows の `CreateProcess` は bare command を起動する際にカレントディレクトリを
 * 検索パスに含めるため、悪意あるリポジトリ直下の `git.exe` / `git-sc.cmd` を
 * 先に解決してしまう (cwd ハイジャック) リスクがある。
 * この関数は PATH 要素のうち絶対パスのみを許容し、空文字列・カレントディレクトリ参照・
 * `.\tools` のような相対パスは全て除外する。
 *
 * POSIX の `execvp` も PATH に空要素や `.` が含まれるとカレントディレクトリを
 * 探索するため、Windows と同様に絶対パス要素だけを許可する。
 *
 * @returns 解決できた絶対パス、見つからない場合は null
 */
export function resolveExecutableOnPath(name: string): string | null {
	const isWindows = globalThis.process.platform === "win32";
	const pathModule = isWindows ? path.win32 : path.posix;
	const pathDelimiter = isWindows ? ";" : ":";

	const pathDirs = getPathEnvValue().split(pathDelimiter);
	// PATHEXT が空文字列・空白のみ・セパレータのみ (";" や " ; ; ") の場合は
	// 未設定と同じくデフォルトへフォールバックする。
	// `??` だけでは空文字列を素通しし `pathExts` が空配列になり、
	// Windows で `.EXE` / `.CMD` / `.BAT` / `.COM` の探索が一切走らず誤って未検出扱いになる。
	const DEFAULT_PATH_EXT = ".EXE;.CMD;.BAT;.COM";
	const rawPathExt = globalThis.process.env.PATHEXT ?? DEFAULT_PATH_EXT;
	let pathExts = rawPathExt
		.split(";")
		.map((ext) => ext.trim())
		.filter(Boolean);
	if (pathExts.length === 0) {
		pathExts = DEFAULT_PATH_EXT.split(";");
	}

	for (const rawDir of pathDirs) {
		const dir = isWindows ? rawDir.trim() : rawDir;
		// 絶対パスのみ許可する（空文字列・"."・"./"・".\\"・"bin"・".\tools"・"C:tools" 等は全て除外）。
		// 相対要素を許すと `spawn(..., { cwd: workspaceRoot })` と合わさって
		// repo 配下のバイナリが起動する余地を残してしまうため、ここで完全に弾く。
		if (!dir || !pathModule.isAbsolute(dir)) {
			continue;
		}

		if (!isWindows) {
			const candidate = pathModule.join(dir, name);
			if (isExecutableFile(candidate)) {
				return candidate;
			}
			continue;
		}

		// PATHEXT 順で拡張子付き候補を確認（`path.win32.join` で Windows 形式を維持）
		for (const ext of pathExts) {
			const candidate = pathModule.join(dir, name + ext);
			if (isRegularFile(candidate)) {
				return candidate;
			}
		}

		// name 自体が拡張子を含むケース
		const direct = pathModule.join(dir, name);
		if (isRegularFile(direct)) {
			return direct;
		}
	}

	return null;
}

/**
 * シェルを介さず `execFileSync` / `spawn` へ直接渡せる native 実行ファイルを解決する。
 *
 * Windows の `.cmd` / `.bat` は直接実行できず shell が必要になるため、ここでは `.exe` / `.com`
 * だけを許可する。`git` や `taskkill` のように shell を不要にしたいコマンドで使う。
 */
export function resolveNativeExecutableOnPath(name: string): string | null {
	if (globalThis.process.platform !== "win32") {
		return resolveExecutableOnPath(name);
	}

	const pathDirs = getPathEnvValue().split(";");
	const directExtension = path.win32.extname(name);
	const candidateNames = directExtension
		? [name]
		: [`${name}.EXE`, `${name}.COM`];

	for (const rawDir of pathDirs) {
		const dir = rawDir.trim();
		if (!dir || !path.win32.isAbsolute(dir)) {
			continue;
		}

		for (const candidateName of candidateNames) {
			const candidate = path.win32.join(dir, candidateName);
			if (isRegularFile(candidate)) {
				return candidate;
			}
		}
	}

	return null;
}

/**
 * Windows の System32 配下にある OS 標準コマンドを絶対パスで解決する。
 *
 * `taskkill` などを bare command で起動すると current directory 探索の対象になるため、
 * SystemRoot/WINDIR から `System32\<name>.exe` を組み立て、通常ファイルの場合だけ返す。
 */
export function resolveWindowsSystemExecutable(name: string): string | null {
	if (globalThis.process.platform !== "win32") {
		return null;
	}

	const systemRoot =
		getWindowsEnvValue("SystemRoot") || getWindowsEnvValue("WINDIR");
	if (!systemRoot || !path.win32.isAbsolute(systemRoot)) {
		return null;
	}

	const executableName = name.toLowerCase().endsWith(".exe")
		? name
		: `${name}.exe`;
	const candidate = path.win32.join(systemRoot, "System32", executableName);
	return isRegularFile(candidate) ? candidate : null;
}

/**
 * `child_process.spawn` で安全に実行ファイルを起動するための
 * コマンドパスとシェル指定を返す。
 *
 * - POSIX: PATH の絶対パス要素から実行可能ファイルを解決して返す。
 *   空要素や `.` が含まれる PATH でも workspaceRoot 配下の実行ファイルを拾わない。
 * - Windows: PATH 走査で絶対パスを解決して bare command 起動時の cwd ハイジャックを回避する。
 *   `.cmd` / `.bat` は CVE-2024-27980 対策で `shell: true` が必須、それ以外（`.exe` 等）は
 *   `shell: false` で直接起動できる。
 *
 * PATH 上に解決できなかった場合は `null` を返す。
 * 呼び出し側はこれを受けて未検出ダイアログ等にフォールバックすること。
 * （bare command + `shell: true` でフォールバックすると cwd ハイジャックが復活するため使わない）
 */
export function resolveSpawnCommand(name: string): {
	command: string;
	useShell: boolean;
} | null {
	const resolved = resolveExecutableOnPath(name);
	if (!resolved) {
		// 安全な絶対パスが得られないため、呼び出し側で未検出として扱う
		return null;
	}

	const lower = resolved.toLowerCase();
	const useShell =
		globalThis.process.platform === "win32" &&
		(lower.endsWith(".cmd") || lower.endsWith(".bat"));
	return { command: resolved, useShell };
}
