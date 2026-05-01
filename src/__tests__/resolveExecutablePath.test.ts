import { accessSync, existsSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	resolveExecutableOnPath,
	resolveSpawnCommand,
} from "../commands/resolveExecutablePath";

vi.mock("node:fs", () => ({
	accessSync: vi.fn(),
	constants: { X_OK: 1 },
	existsSync: vi.fn(),
}));

const mockAccessSync = vi.mocked(accessSync);
const mockExistsSync = vi.mocked(existsSync);

describe("resolveExecutableOnPath", () => {
	let originalPlatform: PropertyDescriptor | undefined;
	let originalPath: string | undefined;
	let originalPathExt: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
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
		expect(mockExistsSync).not.toHaveBeenCalled();
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
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it("POSIX で PATH が相対要素のみの場合は null を返す", () => {
		setPlatform("linux");
		globalThis.process.env.PATH = ":.:./bin:bin";

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
		expect(mockAccessSync).not.toHaveBeenCalled();
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it("returns the absolute path when found in PATH on Windows", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools;C:\\Program Files\\Git\\cmd";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\Program Files\\Git\\cmd\\git-sc.CMD",
		);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\Program Files\\Git\\cmd\\git-sc.CMD");
	});

	it("skips empty PATH entries to defend against cwd-only PATH = ';C:\\\\Tools'", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = ";C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\tools\\git-sc.EXE",
		);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
		// 空文字列要素では existsSync が呼ばれないこと
		const calls = mockExistsSync.mock.calls.map((c) => c[0] as string);
		expect(calls.every((c) => !c.startsWith("git-sc"))).toBe(true);
	});

	it("skips '.' / './' / '.\\\\' (current directory references)", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = ".;./;.\\;C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\tools\\git-sc.EXE",
		);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.EXE");
		// カレントディレクトリ参照に対して existsSync が呼ばれないこと
		const calls = mockExistsSync.mock.calls.map((c) => c[0] as string);
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
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\Windows\\git-sc.EXE",
		);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\Windows\\git-sc.EXE");
		const calls = mockExistsSync.mock.calls.map((c) => c[0] as string);
		// 相対要素由来の候補は走査されない
		expect(calls.some((c) => c.startsWith("bin"))).toBe(false);
		expect(calls.some((c) => c.startsWith(".\\tools"))).toBe(false);
		expect(calls.some((c) => c.startsWith("C:tools"))).toBe(false);
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
		mockExistsSync.mockReturnValue(true);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBeNull();
		expect(mockExistsSync).not.toHaveBeenCalled();
	});

	it("falls back to PATHEXT default when env var is missing", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		delete globalThis.process.env.PATHEXT;
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\tools\\git-sc.BAT",
		);

		const result = resolveExecutableOnPath("git-sc");
		expect(result).toBe("C:\\tools\\git-sc.BAT");
	});

	it("returns the direct (extensionless) path when name already includes extension", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\tools";
		globalThis.process.env.PATHEXT = ".EXE";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\tools\\git-sc.exe",
		);

		const result = resolveExecutableOnPath("git-sc.exe");
		expect(result).toBe("C:\\tools\\git-sc.exe");
	});

	it("returns null when nothing exists on PATH", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\one;C:\\two";
		globalThis.process.env.PATHEXT = ".EXE";
		mockExistsSync.mockReturnValue(false);

		expect(resolveExecutableOnPath("git-sc")).toBeNull();
	});
});

describe("resolveSpawnCommand", () => {
	let originalPlatform: PropertyDescriptor | undefined;
	let originalPath: string | undefined;
	let originalPathExt: string | undefined;

	beforeEach(() => {
		vi.clearAllMocks();
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
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\Program Files\\Git\\cmd\\git-sc.CMD",
		);

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\Program Files\\Git\\cmd\\git-sc.CMD",
			useShell: true,
		});
	});

	it("Windows で .EXE が見つかった場合は絶対パス + shell:false を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE;.CMD";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\bin\\git-sc.EXE",
		);

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\bin\\git-sc.EXE",
			useShell: false,
		});
	});

	it("Windows で .BAT が見つかった場合は shell:true を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".BAT";
		mockExistsSync.mockImplementation(
			(p: unknown) => p === "C:\\bin\\git-sc.BAT",
		);

		expect(resolveSpawnCommand("git-sc")).toEqual({
			command: "C:\\bin\\git-sc.BAT",
			useShell: true,
		});
	});

	it("Windows で見つからない場合は null を返す（cwd ハイジャック対策、フォールバック spawn は行わない）", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "C:\\bin";
		globalThis.process.env.PATHEXT = ".EXE";
		mockExistsSync.mockReturnValue(false);

		expect(resolveSpawnCommand("git-sc")).toBeNull();
	});

	it("Windows で PATH が空の場合は null を返す", () => {
		setPlatform("win32");
		globalThis.process.env.PATH = "";
		expect(resolveSpawnCommand("git-sc")).toBeNull();
	});
});
