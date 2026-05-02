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
	let originalPathExt: string | undefined;
	let originalSystemRoot: string | undefined;
	let originalWindir: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
		mockStatSync.mockReturnValue(mockFileStat(true));
		originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		originalPath = globalThis.process.env.PATH;
		originalPathExt = globalThis.process.env.PATHEXT;
		originalSystemRoot = globalThis.process.env.SystemRoot;
		originalWindir = globalThis.process.env.WINDIR;
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
		if (originalSystemRoot === undefined) {
			delete globalThis.process.env.SystemRoot;
		} else {
			globalThis.process.env.SystemRoot = originalSystemRoot;
		}
		if (originalWindir === undefined) {
			delete globalThis.process.env.WINDIR;
		} else {
			globalThis.process.env.WINDIR = originalWindir;
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

	it("Windows の System32 実行ファイル解決は相対 SystemRoot を拒否する", () => {
		setPlatform("win32");
		globalThis.process.env.SystemRoot = "Windows";

		expect(resolveWindowsSystemExecutable("taskkill")).toBeNull();
		expect(mockStatSync).not.toHaveBeenCalled();
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

	it("POSIX では絶対パス + shell:false を返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = "/usr/local/bin:/usr/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "/usr/local/bin/git-sc",
			useShell: false,
		});
	});

	it("POSIX では .cmd 名でも shell:false を返す", () => {
		setPlatform("darwin");
		globalThis.process.env.PATH = "/usr/local/bin";
		mockAccessSync.mockImplementation((p: unknown) => {
			if (p === "/usr/local/bin/git-sc.cmd") {
				return;
			}
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc.cmd")).toEqual({
			command: "/usr/local/bin/git-sc.cmd",
			useShell: false,
		});
	});

	it("POSIX で実行可能ファイルが見つからない場合は null を返す", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = ".:/usr/bin";
		mockAccessSync.mockImplementation(() => {
			throw new Error("not executable");
		});

		expect(resolveSpawnCommand("git-sc")).toBeNull();
	});

	it("Windows で .CMD が見つかった場合は絶対パス + shell:true を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\Program Files\\Git\\cmd";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\Program Files\\Git\\cmd\\git-sc.CMD") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\Program Files\\Git\\cmd\\git-sc.CMD",
			useShell: true,
		});
	});

	it("Windows で .EXE が見つかった場合は絶対パス + shell:false を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\bin\\git-sc.EXE") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\bin\\git-sc.EXE",
			useShell: false,
		});
	});

	it("Windows で .BAT が見つかった場合は shell:true を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".BAT";
		mockStatSync.mockImplementation((p: unknown) => {
			if (p === "C:\\bin\\git-sc.BAT") {
				return mockFileStat(true);
			}
			throw new Error("not found");
		});

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\bin\\git-sc.BAT",
			useShell: true,
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
});
