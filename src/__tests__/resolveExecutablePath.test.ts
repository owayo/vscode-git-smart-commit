import { accessSync, type Stats, statSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveExecutableOnPath,
	resolveNativeExecutableOnPath,
	resolveSpawnCommand,
	resolveWindowsSystemExecutable,
} from "../commands/resolveExecutablePath";

vi.mock("node:fs", () => ({
	accessSync: vi.fn(),
	constants: { X_OK: 1 },
	statSync: vi.fn(),
}));

const mockAccessSync = vi.mocked(accessSync);
const mockStatSync = vi.mocked(statSync);

function mockFileStat(isFile: boolean): Stats {
	return { isFile: () => isFile } as Stats;
}

describe("resolveExecutableOnPath", () => {
	let originalPlatform: PropertyDescriptor | undefined;
	let originalPath: string | undefined;
	let originalTitlePath: string | undefined;
	let originalLowerPath: string | undefined;
	let originalPathExt: string | undefined;
	let originalSystemRoot: string | undefined;
	let originalLowerSystemRoot: string | undefined;
	let originalWindir: string | undefined;
	let originalLowerWindir: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStatSync.mockReturnValue(mockFileStat(true));
		originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		originalPath = globalThis.process.env.PATH;
		originalTitlePath = globalThis.process.env.Path;
		originalLowerPath = globalThis.process.env.path;
		originalPathExt = globalThis.process.env.PATHEXT;
		originalSystemRoot = globalThis.process.env.SystemRoot;
		originalLowerSystemRoot = globalThis.process.env.systemroot;
		originalWindir = globalThis.process.env.WINDIR;
		originalLowerWindir = globalThis.process.env.windir;
	});

	afterEach(() => {
		if (originalPlatform) {
			Object.defineProperty(globalThis.process, "platform", originalPlatform);
		}
		if (originalPath === undefined) {
			delete globalThis.process.env.PATH;
		} else {
			globalThis.process.env.PATH = originalPath;
		}
		if (originalTitlePath === undefined) {
			delete globalThis.process.env.Path;
		} else {
			globalThis.process.env.Path = originalTitlePath;
		}
		if (originalLowerPath === undefined) {
			delete globalThis.process.env.path;
		} else {
			globalThis.process.env.path = originalLowerPath;
		}
		if (originalPathExt === undefined) {
			delete globalThis.process.env.PATHEXT;
		} else {
			globalThis.process.env.PATHEXT = originalPathExt;
		}
		if (originalSystemRoot === undefined) {
			delete globalThis.process.env.SystemRoot;
		} else {
			globalThis.process.env.SystemRoot = originalSystemRoot;
		}
		if (originalLowerSystemRoot === undefined) {
			delete globalThis.process.env.systemroot;
		} else {
			globalThis.process.env.systemroot = originalLowerSystemRoot;
		}
		if (originalWindir === undefined) {
			delete globalThis.process.env.WINDIR;
		} else {
			globalThis.process.env.WINDIR = originalWindir;
		}
		if (originalLowerWindir === undefined) {
			delete globalThis.process.env.windir;
		} else {
			globalThis.process.env.windir = originalLowerWindir;
		}
	});

	function setPlatform(platform: NodeJS.Platform): void {
		Object.defineProperty(globalThis.process, "platform", {
			value: platform,
			configurable: true,
		});
	}

	it("POSIX でも絶対 PATH 要素から実行可能ファイルを返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = ".:/usr/local/bin:/usr/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveExecutableOnPath("git-sc")).toBe("/usr/local/bin/git-sc");
		expect(mockStatSync).toHaveBeenCalledWith("/usr/local/bin/git-sc");
	});

	it("POSIX でも空要素・カレントディレクトリ・相対 PATH 要素を除外する", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = ":.:./bin:bin:/usr/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveExecutableOnPath("git-sc")).toBe("/usr/bin/git-sc");
		const calls = mockAccessSync.mock.calls.map((c) => c[0] as string);
		expect(calls).toEqual(["/usr/bin/git-sc"]);
		expect(mockStatSync).toHaveBeenCalledWith("/usr/bin/git-sc");
	});

	it("POSIX で実行権限付きディレクトリを候補から除外する", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = "/usr/local/bin:/usr/bin";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc") {
				return mockFileStat(false);
			}
			if (p === "/usr/bin/git-sc") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveExecutableOnPath("git-sc")).toBe("/usr/bin/git-sc");
		expect(mockAccessSync).not.toHaveBeenCalledWith("/usr/local/bin/git-sc", 1);
	});

	it("POSIX で PATH が相対要素のみの場合は null を返す", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = ":.:./bin:bin";

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
		expect(mockAccessSync).not.toHaveBeenCalled();
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it("POSIX で PATH 環境変数自体が未定義の場合は null を返す", () => {
		// POSIX では PATH が未定義のとき Windows のような大文字小文字 fallback は行わない。
		// `getPathEnvValue()` が空文字列を返し、空配列を iterate するだけで終わる安全側の挙動を保証する。
		setPlatform("darwin");
		delete globalThis.process.env.PATH;

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
		expect(mockAccessSync).not.toHaveBeenCalled();
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it("returns the absolute path when found in PATH on Windows", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools;C:\\Program Files\\Git\\cmd";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Program Files\\Git\\cmd\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\Program Files\\Git\\cmd\\git-sc.CMD");
	});

	it("Windows では PATH が未定義でも Path から探索する", () => {
		setPlatform("win32");
		delete globalThis.process.env.PATH;
		globalThis.process.env.Path = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
	});

	it("Windows では PATH/Path が未定義でも小文字 path から探索する", () => {
		setPlatform("win32");
		delete globalThis.process.env.PATH;
		delete globalThis.process.env.Path;
		globalThis.process.env.path = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
	});

	it("skips empty PATH entries to defend against cwd-only PATH = ';C:\\\\Tools'", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = ";C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
		// 空文字列要素では statSync が呼ばれないこと
		const calls = mockStatSync.mock.calls.map((c) => c[0] as string);
		expect(calls.every((c) => !c.startsWith("git-sc"))).toBe(true);
	});

	it("skips '.' / './' / '.\\\\' (current directory references)", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = ".;./;.\\;C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
		// カレントディレクトリ参照に対して statSync が呼ばれないこと
		const calls = mockStatSync.mock.calls.map((c) => c[0] as string);
		expect(calls).not.toContain(".\\git-sc.EXE");
		expect(calls).not.toContain(".\\\\git-sc.EXE");
	});

	it("skips relative path entries like 'bin' or '.\\\\tools'", () => {
		// PATH 要素の相対パスは Windows の `CreateProcess` がカレントディレクトリ相対で
		// 解決し、`spawn(..., { cwd: workspaceRoot })` と組み合わせると repo 配下を許容してしまうため
		// 完全に弾く必要がある。
		setPlatform("win32");
		globalThis.process.env.PATH = "bin;.\\tools;C:tools;C:\\Windows";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\Windows\\git-sc.EXE");
		const calls = mockStatSync.mock.calls.map((c) => c[0] as string);
		// 相対要素由来の候補は走査されない
		expect(calls.some((c) => c.startsWith("bin"))).toBe(false);
		expect(calls.some((c) => c.startsWith(".\\tools"))).toBe(false);
		expect(calls.some((c) => c.startsWith("C:tools"))).toBe(false);
	});

	it("Windows で同名ディレクトリを候補から除外する", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools;C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(false);
			}
			if (p === "C:\\bin\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\bin\\git-sc.EXE");
	});

	it("returns null when PATH is empty", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "";
		globalThis.process.env.PATHEXT = ".EXE";

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
	});

	it("returns null when PATH contains only relative entries", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = ".;.\\\\bin;tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockReturnValue(mockFileStat(true));

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBeNull();
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it("falls back to PATHEXT default when env var is missing", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		delete globalThis.process.env.PATHEXT;
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.BAT") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.BAT");
	});

	it("PATHEXT が空文字列でもデフォルト拡張子で探索する", () => {
		// PATHEXT="" を `??` で素通しすると pathExts が空配列になり .CMD/.EXE などを
		// 一切探索できなくなるため、未設定と同等にデフォルトへフォールバックすること
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = "";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.CMD");
	});

	it("PATHEXT が空白のみでもデフォルト拡張子で探索する", () => {
		// 空白のみの PATHEXT も実質「未設定」と同義として扱う
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = "   ";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
	});

	it("PATHEXT がセパレータのみでもデフォルト拡張子で探索する", () => {
		// `;` や ` ; ; ` のように区切り文字だけの PATHEXT も `filter(Boolean)` で
		// pathExts が空配列になるためデフォルトへフォールバックする
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = " ; ; ";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.BAT") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.BAT");
	});

	it("returns the direct (extensionless) path when name already includes extension", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc.exe");
		expect(result).toBe("C:\\tools\\git-sc.exe");
	});

	it("Windows で拡張子付き指定に PATHEXT を連結しない", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.cmd.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc.cmd");

		expect(result).toBeNull();
		expect(mockStatSync).toHaveBeenCalledWith("C:\\tools\\git-sc.cmd");
		expect(mockStatSync).not.toHaveBeenCalledWith("C:\\tools\\git-sc.cmd.EXE");
	});

	it("Windows で拡張子付き指定は指定名そのものを優先する", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git-sc.cmd") {
				return mockFileStat(true);
			}
			if (p === "C:\\tools\\git-sc.cmd.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc.cmd");

		expect(result).toBe("C:\\tools\\git-sc.cmd");
		expect(mockStatSync).not.toHaveBeenCalledWith("C:\\tools\\git-sc.cmd.EXE");
	});

	it("returns null when nothing exists on PATH", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\one;C:\\two";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation(() => {
			throw new Error("not found");
		});

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
	});

	it("Windows の native 実行ファイル解決では .CMD より .EXE を優先する", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".CMD;.EXE";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git.EXE") {
				return mockFileStat(true);
			}
			if (p === "C:\\tools\\git.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveNativeExecutableOnPath("git")).toBe("C:\\tools\\git.EXE");
	});

	it("Windows の native 実行ファイル解決では .BAT だけの場合は null を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".BAT";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git.BAT") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveNativeExecutableOnPath("git")).toBeNull();
	});

	it("Windows の native 実行ファイル解決では直接指定された .CMD を返さない", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\tools\\git.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveNativeExecutableOnPath("git.CMD")).toBeNull();
	});

	it("resolveExecutableOnPath は Windows の drive-relative な PATH 要素 (\\Tools) を除外する", () => {
		// path.win32.isAbsolute("\\Tools") は true だが drive-relative であり、実行時の
		// current drive 依存で fully-qualified ではないため、絶対パスとして拾ってはならない。
		setPlatform("win32");
		globalThis.process.env.PATH = "\\Tools;C:\\safe";
		globalThis.process.env.PATHEXT = ".CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\safe\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveExecutableOnPath("git-sc");

		expect(result).toBe("C:\\safe\\git-sc.CMD");
		// drive-relative 要素はそもそも statSync の探索対象にしない
		expect(mockStatSync).not.toHaveBeenCalledWith("\\Tools\\git-sc.CMD");
	});

	it("resolveExecutableOnPath は Windows の UNC パス要素を受け入れる", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "\\\\server\\share\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "\\\\server\\share\\bin\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveExecutableOnPath("git-sc")).toBe(
			"\\\\server\\share\\bin\\git-sc.CMD",
		);
	});

	it("resolveExecutableOnPath は退化した UNC 前置 (\\\\ や \\\\server) を除外する", () => {
		// "\\" / "\\server" (share なし) は path.win32.join すると "\file" のような
		// drive-relative パスに正規化され current drive 依存に戻るため、fully-qualified
		// として扱ってはならない。server/share の両方を備えた UNC だけ許可する。
		setPlatform("win32");
		globalThis.process.env.PATH = "\\\\;\\\\server;C:\\safe";
		globalThis.process.env.PATHEXT = ".CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\safe\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveExecutableOnPath("git-sc")).toBe("C:\\safe\\git-sc.CMD");
		// 退化した UNC 前置は探索対象にしない（C:\safe の候補だけが statSync される）
		const statPaths = mockStatSync.mock.calls.map((c) => c[0]);
		expect(statPaths).toEqual(["C:\\safe\\git-sc.CMD"]);
	});

	it("resolveNativeExecutableOnPath は Windows の drive-relative な PATH 要素を除外する", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "\\Tools;C:\\safe";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\safe\\git.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveNativeExecutableOnPath("git")).toBe("C:\\safe\\git.EXE");
		expect(mockStatSync).not.toHaveBeenCalledWith("\\Tools\\git.EXE");
	});

	it("Windows の System32 実行ファイルを SystemRoot から絶対パスで解決する", () => {
		setPlatform("win32");
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\System32\\taskkill.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveWindowsSystemExecutable("taskkill")).toBe(
			"C:\\Windows\\System32\\taskkill.exe",
		);
	});

	it("Windows の System32 実行ファイルを WINDIR から絶対パスで解決する", () => {
		setPlatform("win32");
		delete globalThis.process.env.SystemRoot;
		globalThis.process.env.WINDIR = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\System32\\taskkill.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveWindowsSystemExecutable("taskkill")).toBe(
			"C:\\Windows\\System32\\taskkill.exe",
		);
	});

	it("Windows の System32 実行ファイルを小文字 systemroot から絶対パスで解決する", () => {
		setPlatform("win32");
		delete globalThis.process.env.SystemRoot;
		delete globalThis.process.env.WINDIR;
		globalThis.process.env.systemroot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\System32\\taskkill.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveWindowsSystemExecutable("taskkill")).toBe(
			"C:\\Windows\\System32\\taskkill.exe",
		);
	});

	it("Windows の System32 実行ファイルを小文字 windir から絶対パスで解決する", () => {
		setPlatform("win32");
		delete globalThis.process.env.SystemRoot;
		delete globalThis.process.env.WINDIR;
		delete globalThis.process.env.systemroot;
		globalThis.process.env.windir = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\System32\\taskkill.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveWindowsSystemExecutable("taskkill")).toBe(
			"C:\\Windows\\System32\\taskkill.exe",
		);
	});

	it("Windows の System32 実行ファイル解決は相対 SystemRoot を拒否する", () => {
		setPlatform("win32");
		globalThis.process.env.SystemRoot = "Windows";

		expect(resolveWindowsSystemExecutable("taskkill")).toBeNull();
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it("Windows の System32 実行ファイル解決は drive-relative な SystemRoot を拒否する", () => {
		// "\\Windows" は path.win32.isAbsolute では true だが drive-relative であり、
		// current drive 依存で fully-qualified ではないため拒否する。
		setPlatform("win32");
		globalThis.process.env.SystemRoot = "\\Windows";

		expect(resolveWindowsSystemExecutable("taskkill")).toBeNull();
		expect(mockStatSync).not.toHaveBeenCalled();
	});

	it("Windows の System32 実行ファイル解決は同名ディレクトリを拒否する", () => {
		setPlatform("win32");
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Windows\\System32\\taskkill.exe") {
				return mockFileStat(false);
			}
			throw new Error("not found");
		});

		expect(resolveWindowsSystemExecutable("taskkill")).toBeNull();
	});
});

describe("resolveSpawnCommand", () => {
	let originalPlatform: PropertyDescriptor | undefined;
	let originalPath: string | undefined;
	let originalPathExt: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStatSync.mockReturnValue(mockFileStat(true));
		originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		originalPath = globalThis.process.env.PATH;
		originalPathExt = globalThis.process.env.PATHEXT;
	});

	afterEach(() => {
		if (originalPlatform) {
			Object.defineProperty(globalThis.process, "platform", originalPlatform);
		}
		if (originalPath === undefined) {
			delete globalThis.process.env.PATH;
		} else {
			globalThis.process.env.PATH = originalPath;
		}
		if (originalPathExt === undefined) {
			delete globalThis.process.env.PATHEXT;
		} else {
			globalThis.process.env.PATHEXT = originalPathExt;
		}
	});

	function setPlatform(platform: NodeJS.Platform): void {
		Object.defineProperty(globalThis.process, "platform", {
			value: platform,
			configurable: true,
		});
	}

	it("POSIX では絶対パス + 引数パススルー + windowsVerbatimArguments:false を返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = "/usr/local/bin:/usr/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc", ["-a", "-y"])).toEqual({
			command: "/usr/local/bin/git-sc",
			args: ["-a", "-y"],
			windowsVerbatimArguments: false,
		});
	});

	it("POSIX で args が省略された場合は空配列を返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = "/usr/local/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "/usr/local/bin/git-sc",
			args: [],
			windowsVerbatimArguments: false,
		});
	});

	it("POSIX では .cmd 名でも cmd.exe を介さず絶対パスをそのまま返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = "/usr/local/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc.cmd") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc.cmd", ["-y"])).toEqual({
			command: "/usr/local/bin/git-sc.cmd",
			args: ["-y"],
			windowsVerbatimArguments: false,
		});
	});

	it("POSIX で実行可能ファイルが見つからない場合は null を返す", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = ".:/usr/bin";
		mockAccessSync.mockImplementation(() => {
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc", ["-y"])).toBeNull();
	});

	it("Windows で .CMD が見つかった場合は cmd.exe 経由で安全に起動する形を返す", () => {
		// Node.js DEP0190 (shell:true + args の unsafe な空白連結) を避けるため、
		// cmd.exe を System32 から絶対パスで解決し windowsVerbatimArguments:true を返す。
		// 各引数は CommandLineToArgvW 互換で自前 quote 済み。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\Program Files\\Git\\cmd";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Program Files\\Git\\cmd\\git-sc.CMD") {
				return mockFileStat(true);
			}
			if (p === "C:\\Windows\\System32\\cmd.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc", ["-y"])).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'""C:\\Program Files\\Git\\cmd\\git-sc.CMD" "-y""',
			],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows で .EXE が見つかった場合は絶対パス + windowsVerbatimArguments:false を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\bin\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc", ["-y"])).toEqual({
			command: "C:\\bin\\git-sc.EXE",
			args: ["-y"],
			windowsVerbatimArguments: false,
		});
	});

	it("Windows で .BAT が見つかった場合も cmd.exe 経由で起動する形を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".BAT";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\bin\\git-sc.BAT") {
				return mockFileStat(true);
			}
			if (p === "C:\\Windows\\System32\\cmd.exe") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", '""C:\\bin\\git-sc.BAT""'],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows で .CMD は見つかるが cmd.exe を解決できない場合は null を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		delete globalThis.process.env.SystemRoot;
		delete globalThis.process.env.WINDIR;
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\bin\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc", ["-y"])).toBeNull();
	});

	it("Windows の cmd.exe 経由起動では空白入りパスを正しく quote する", () => {
		// `C:\Program Files\...` のように空白を含む PATH は実環境で頻出する。
		// 自前 quote で各 token を `"` で囲み、cmd.exe /s 仕様に合わせて全体をさらに
		// `"` で囲んだ command line になることを保証する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\Program Files\\Git Smart Commit\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\Program Files\\Git Smart Commit\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveSpawnCommand("git-sc", ["-a", "-y"]);

		expect(result).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'""C:\\Program Files\\Git Smart Commit\\bin\\git-sc.CMD" "-a" "-y""',
			],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows の cmd.exe 経由起動では cmd メタ文字を含む引数も個別に quote する", () => {
		// & | < > ^ を含む引数が素の command line に露出すると cmd.exe が制御記号として解釈する。
		// .cmd/.bat 経由では各引数を必ず二重引用符で囲み、1 つの引数として渡すことを固定する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveSpawnCommand("git-sc", [
			"value&safe",
			"pipe|safe",
			"redir<safe>",
			"caret^safe",
		]);

		expect(result).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: [
				"/d",
				"/s",
				"/c",
				'""C:\\bin\\git-sc.CMD" "value&safe" "pipe|safe" "redir<safe>" "caret^safe""',
			],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows の cmd.exe 経由起動では引数内のダブルクォートを CommandLineToArgvW 互換でエスケープする", () => {
		// 引数に " が含まれる場合、エスケープを誤ると cmd.exe 上で引数が分割され
		// インジェクションの余地が生まれる。CommandLineToArgvW 規則どおり、" の直前の
		// バックスラッシュを 2n+1 個にして \" として 1 引数の内側へ閉じ込める。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveSpawnCommand("git-sc", ['a"b']);

		expect(result).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", '""C:\\bin\\git-sc.CMD" "a\\"b""'],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows の cmd.exe 経由起動では末尾バックスラッシュを閉じ引用符の前で倍にする", () => {
		// 末尾が \ で終わる引数は、そのまま閉じ " の前に置くと \" と解釈され
		// 閉じ引用符が無効化されてしまう。CommandLineToArgvW 規則どおり、末尾の
		// バックスラッシュ n 個を 2n 個へ倍化してから閉じることでパスを保全する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		const result = resolveSpawnCommand("git-sc", ["end\\"]);

		expect(result).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", '""C:\\bin\\git-sc.CMD" "end\\\\""'],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows の cmd.exe 経由起動ではダブルクォート直前のバックスラッシュを 2n+1 個へ拡張する", () => {
		// CommandLineToArgvW では `"` の直前にあるバックスラッシュ n 個を 2n+1 個へ拡張する
		// 必要がある (n 個をリテラル化する 2n 個 + `"` をエスケープする 1 個)。誤って `+1` だけだと
		// バックスラッシュが 1 個に潰れて引数境界が崩れ、インジェクションの余地が生まれる。
		// 既存テストは「バックスラッシュを伴わない `"`」と「末尾バックスラッシュ」を個別に検証して
		// いたが、両者が隣接する `a\"b` のケース (backslashes>0 のまま `"` に到達する分岐) は
		// 未カバーだったため、ここで 2n+1 拡張を固定する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		// 入力リテラルは a \ " b の 4 文字。`\` 1 個 + `"` なので CommandLineToArgvW 規則では
		// バックスラッシュが 2*1+1=3 個へ拡張され `a\\\"b` (= a + `\` 3 個 + `"` + b) になる。
		const result = resolveSpawnCommand("git-sc", ['a\\"b']);

		expect(result).toEqual({
			command: "C:\\Windows\\System32\\cmd.exe",
			args: ["/d", "/s", "/c", '""C:\\bin\\git-sc.CMD" "a\\\\\\"b""'],
			windowsVerbatimArguments: true,
		});
	});

	it("Windows で見つからない場合は null を返す（cwd ハイジャック対策、フォールバック spawn は行わない）", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE";
		mockStatSync.mockImplementation(() => {
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc")).toBeNull();
	});

	it("Windows で PATH が空の場合は null を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "";
		expect(resolveSpawnCommand("git-sc")).toBeNull();
	});

	it("Windows の cmd 経由起動で改行や NUL を含む引数は例外を投げる", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(() => resolveSpawnCommand("git-sc", ["bad\narg"])).toThrow(
			/unsupported control characters/,
		);
	});

	it("Windows の cmd 経由起動で % を含む引数は例外を投げる (環境変数展開の防止)", () => {
		// cmd.exe は二重引用符の内側でも %VAR% を展開し、コマンドライン上で % を確実に
		// エスケープする手段がない。誤展開・誤実行を防ぐため % を含む引数は拒否する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(() => resolveSpawnCommand("git-sc", ["%USERNAME%"])).toThrow(/%/);
	});

	it("Windows の cmd 経由起動で実行ファイルパスに % を含む場合も例外を投げる", () => {
		// 実行ファイルパスに % が含まれる (例: %USERNAME% を含むディレクトリ) 場合、
		// cmd.exe が展開して別パスを実行する事故を防ぐため拒否する。
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\Tools%USERNAME%\\bin";
		globalThis.process.env.PATHEXT = ".CMD";
		globalThis.process.env.SystemRoot = "C:\\Windows";
		mockStatSync.mockImplementation((p: unknown) => {
			if (
				p === "C:\\Tools%USERNAME%\\bin\\git-sc.CMD" ||
				p === "C:\\Windows\\System32\\cmd.exe"
			) {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(() => resolveSpawnCommand("git-sc")).toThrow(/%/);
	});
});
