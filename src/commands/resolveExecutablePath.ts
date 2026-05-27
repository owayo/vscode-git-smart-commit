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

		// 拡張子付きで指定された場合は、指定名そのものだけを確認する。
		// PATHEXT を連結すると `git-sc.cmd.EXE` のような別ファイルを誤って返してしまう。
		if (path.win32.extname(name)) {
			const direct = pathModule.join(dir, name);
			if (isRegularFile(direct)) {
				return direct;
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
	if (
		directExtension &&
		![".exe", ".com"].includes(directExtension.toLowerCase())
	) {
		// native 実行ファイルとして直接起動できない .cmd/.bat 等は返さない。
		return null;
	}
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
 * Windows コマンドライン仕様 (CommandLineToArgvW 互換) で 1 引数を quote する。
 *
 * cmd.exe `/s /c "..."` 経由で `.cmd` / `.bat` を起動する際、
 * `windowsVerbatimArguments: true` で Node を経由した自動 quote を抑止しつつ、
 * 自前で安全に quote する必要がある。`shell: true` + `args` 配列の組み合わせは
 * Node.js DEP0190 で「値が escape されず空白連結される」ため、空白入りパスや
 * cmd.exe メタ文字 (`&` `|` `<` `>` `^`) を含む引数で shell injection の余地が残る。
 */
function escapeCmdArgument(value: string): string {
	// 制御文字 (改行・NUL) は cmd.exe では引数として渡せないので拒否する
	if (/[\r\n\x00]/.test(value)) {
		throw new Error(
			`Argument contains unsupported control characters: ${JSON.stringify(value)}`,
		);
	}

	// CommandLineToArgvW のルールに従ってバックスラッシュと " をエスケープする
	let escaped = "";
	let backslashes = 0;
	for (const ch of value) {
		if (ch === "\\") {
			backslashes += 1;
			continue;
		}
		if (ch === '"') {
			escaped += "\\".repeat(backslashes * 2 + 1) + '"';
			backslashes = 0;
			continue;
		}
		escaped += "\\".repeat(backslashes) + ch;
		backslashes = 0;
	}
	// 末尾のバックスラッシュは閉じ " の前で倍にする必要がある
	escaped += "\\".repeat(backslashes * 2);
	return `"${escaped}"`;
}

/**
 * `cmd.exe /d /s /c "..."` 仕様に従い、実行ファイル + 引数を 1 行に組み立てる。
 *
 * `/s` フラグは「最初と最後の " を剥がす」だけのため、引数ごとに quote した
 * `"path\\to\\file.cmd" "-y"` を全体としてさらに `"` で囲むだけで安全に伝達できる。
 */
function buildCmdCommandLine(executable: string, args: string[]): string {
	const tokens = [executable, ...args].map(escapeCmdArgument);
	return `"${tokens.join(" ")}"`;
}

export interface SpawnCommandResolution {
	/** spawn に渡す実行ファイル (常に絶対パス) */
	command: string;
	/** spawn に渡す引数。`.cmd`/`.bat` 経由起動時は `["/d", "/s", "/c", "..."]` 形式 */
	args: string[];
	/**
	 * `child_process.spawn` の `windowsVerbatimArguments` 指定。
	 * cmd.exe 経由起動時は自前で組み立てた command line をそのまま CreateProcess へ
	 * 渡すために true を指定する。それ以外は false。
	 */
	windowsVerbatimArguments: boolean;
}

export function resolveSpawnCommand(
	name: string,
	args: readonly string[] = [],
): SpawnCommandResolution | null {
	const resolved = resolveExecutableOnPath(name);
	if (!resolved) {
		return null;
	}

	if (globalThis.process.platform !== "win32") {
		return {
			command: resolved,
			args: [...args],
			windowsVerbatimArguments: false,
		};
	}

	const lower = resolved.toLowerCase();
	const needsCmdExe = lower.endsWith(".cmd") || lower.endsWith(".bat");
	if (!needsCmdExe) {
		return {
			command: resolved,
			args: [...args],
			windowsVerbatimArguments: false,
		};
	}

	// `.cmd` / `.bat` は CreateProcess で直接起動できないため cmd.exe 経由で起動する。
	// cmd.exe は必ず System32 配下から絶対パスで resolve し、bare command による cwd ハイジャックを防ぐ。
	// Node.js DEP0190 (shell:true + args の unsafe な空白連結) を回避するため、
	// `windowsVerbatimArguments: true` で生 command line を渡す。各引数は CommandLineToArgvW
	// 互換で自前 quote する。
	const cmdExe = resolveWindowsSystemExecutable("cmd");
	if (!cmdExe) {
		return null;
	}

	const commandLine = buildCmdCommandLine(resolved, [...args]);
	return {
		command: cmdExe,
		args: ["/d", "/s", "/c", commandLine],
		windowsVerbatimArguments: true,
	};
}
