import { execFileSync } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGitWorkspaceRoot } from "../commands/getGitWorkspaceRoot";

const GIT_COMMAND = "/usr/bin/git";
const mockResolveNativeExecutableOnPath = vi.fn();

vi.mock("child_process", () => ({
	execFileSync: vi.fn(),
}));

vi.mock("../commands/resolveExecutablePath", () => ({
	resolveNativeExecutableOnPath: (...args: unknown[]) =>
		mockResolveNativeExecutableOnPath(...args),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe("getGitWorkspaceRoot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockResolveNativeExecutableOnPath.mockReturnValue(GIT_COMMAND);
	});

	it("should skip non-git folders and return the first resolved Git root", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: not a git repository");
			})
			.mockReturnValueOnce("/workspace/repo\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/plain" } },
			{ uri: { fsPath: "/workspace/repo/packages/app" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo");
		// git 実行ファイルは安全に解決した絶対パスを使い、作業ディレクトリは `-C <dir>` で渡す。
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			1,
			GIT_COMMAND,
			["-C", "/workspace/plain", "rev-parse", "--show-toplevel"],
			expect.objectContaining({
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				env: expect.objectContaining({ LC_ALL: "C", LANG: "C" }),
			}),
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			2,
			GIT_COMMAND,
			["-C", "/workspace/repo/packages/app", "rev-parse", "--show-toplevel"],
			expect.objectContaining({
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
				env: expect.objectContaining({ LC_ALL: "C", LANG: "C" }),
			}),
		);
	});

	it("should return the Git root for a single workspace folder", () => {
		mockExecFileSync.mockReturnValueOnce("/workspace/repo\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/repo" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo");
		expect(mockExecFileSync).toHaveBeenCalledTimes(1);
	});

	it("should return null when git rev-parse returns empty string", () => {
		mockExecFileSync.mockReturnValueOnce("\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/folder" } },
		] as never);

		expect(workspaceRoot).toBeNull();
	});

	it("should preserve trailing spaces in resolved Git root paths", () => {
		mockExecFileSync.mockReturnValueOnce("/workspace/repo \n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/repo /packages/app" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo ");
	});

	it("should preserve a trailing carriage return on POSIX Git root paths", () => {
		// POSIX のディレクトリ名末尾に CR (`\r`) を含むパスは有効。git は LF だけを付けて
		// `…/repo\r\n` を返すため、CRLF とみなして 2 文字削ると本来の末尾 `\r` が失われる。
		// POSIX (この実行環境) では LF だけを除去し、末尾 CR を保持することを検証する。
		mockExecFileSync.mockReturnValueOnce("/workspace/repo\r\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/repo\r/packages/app" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo\r");
	});

	it("should strip a CRLF terminator on Windows Git root paths", () => {
		// Windows のパスには制御文字 `\r` を含められないため、`\r\n` は常に git が付けた
		// 行終端とみなして 2 文字除去する。POSIX と同じ「LF 1 文字だけ除去」に退行すると
		// 末尾に `\r` が残り、存在しないディレクトリを cwd に git-sc を spawn してしまう。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});
		try {
			mockExecFileSync.mockReturnValueOnce("C:\\workspace\\repo\r\n");

			const workspaceRoot = getGitWorkspaceRoot([
				{ uri: { fsPath: "C:\\workspace\\repo\\packages\\app" } },
			] as never);

			expect(workspaceRoot).toBe("C:\\workspace\\repo");
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should strip a bare LF terminator on Windows Git root paths", () => {
		// Windows の git も通常は LF だけを付けて返すため、CRLF 専用の 2 文字除去に
		// 倒れて LF 単体の行終端を取りこぼさないことを検証する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});
		try {
			mockExecFileSync.mockReturnValueOnce("C:\\workspace\\repo\n");

			const workspaceRoot = getGitWorkspaceRoot([
				{ uri: { fsPath: "C:\\workspace\\repo\\packages\\app" } },
			] as never);

			expect(workspaceRoot).toBe("C:\\workspace\\repo");
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should return the Git root unchanged when output has no trailing newline", () => {
		// git rev-parse --show-toplevel は通常末尾に LF を付けるが、万一 LF の無い出力でも
		// パス本体を 1 文字削って破壊しないことを保証する (stripGitTrailingLineTerminator の
		// 「改行なし → そのまま返す」防御分岐を固定)。末尾 1 文字を無条件に削る実装に退行すると
		// 存在しない cwd で git-sc を spawn する余地が生じる。
		mockExecFileSync.mockReturnValueOnce("/workspace/repo");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/repo" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo");
	});

	it("should return null when no workspace folder is inside a Git repository", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("fatal: not a git repository");
		});

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/plain-a" } },
			{ uri: { fsPath: "/workspace/plain-b" } },
		] as never);

		expect(workspaceRoot).toBeNull();
	});

	it("should return null when empty array is passed", () => {
		const workspaceRoot = getGitWorkspaceRoot([] as never);

		expect(workspaceRoot).toBeNull();
		expect(mockExecFileSync).not.toHaveBeenCalled();
		expect(mockResolveNativeExecutableOnPath).not.toHaveBeenCalled();
	});

	it("should throw ENOENT error when safe git executable cannot be resolved", () => {
		mockResolveNativeExecutableOnPath.mockReturnValue(null);

		expect(() =>
			getGitWorkspaceRoot([{ uri: { fsPath: "/workspace/folder" } }] as never),
		).toThrow("spawn git ENOENT");
		expect(mockExecFileSync).not.toHaveBeenCalled();
	});

	it("should throw ENOENT error when git is not installed", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("spawn git ENOENT");
		});

		expect(() =>
			getGitWorkspaceRoot([{ uri: { fsPath: "/workspace/folder" } }] as never),
		).toThrow("spawn git ENOENT");
	});

	it("should throw permission error instead of returning null", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error(
				"fatal: unsafe repository ('/workspace/repo' is owned by someone else)",
			);
		});

		expect(() =>
			getGitWorkspaceRoot([{ uri: { fsPath: "/workspace/repo" } }] as never),
		).toThrow("unsafe repository");
	});

	it("should handle case-insensitive 'not a git repository' error", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("fatal: Not A Git Repository (or any parent)");
		});

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/folder" } },
		] as never);

		expect(workspaceRoot).toBeNull();
	});

	it("should pass LC_ALL=C and LANG=C to force English git output", () => {
		mockExecFileSync.mockReturnValueOnce("/workspace/repo\n");

		getGitWorkspaceRoot([{ uri: { fsPath: "/workspace/repo" } }] as never);

		const options = mockExecFileSync.mock.calls[0][2] as {
			env?: Record<string, string>;
		};
		expect(options.env).toBeDefined();
		expect(options.env?.LC_ALL).toBe("C");
		expect(options.env?.LANG).toBe("C");
	});

	it("should include environment variables added after module import", () => {
		const key = "GIT_SMART_COMMIT_TEST_DYNAMIC_ENV";
		const original = globalThis.process.env[key];
		mockExecFileSync.mockReturnValueOnce("/workspace/repo\n");
		globalThis.process.env[key] = "updated-after-import";

		try {
			getGitWorkspaceRoot([{ uri: { fsPath: "/workspace/repo" } }] as never);
		} finally {
			if (original === undefined) {
				delete globalThis.process.env[key];
			} else {
				globalThis.process.env[key] = original;
			}
		}

		const options = mockExecFileSync.mock.calls[0][2] as {
			env?: Record<string, string>;
		};
		expect(options.env?.[key]).toBe("updated-after-import");
	});

	it("should skip not-a-git-repository error and throw on subsequent ENOENT", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: not a git repository");
			})
			.mockImplementationOnce(() => {
				throw new Error("spawn git ENOENT");
			});

		expect(() =>
			getGitWorkspaceRoot([
				{ uri: { fsPath: "/workspace/plain" } },
				{ uri: { fsPath: "/workspace/other" } },
			] as never),
		).toThrow("spawn git ENOENT");
	});

	it("should skip empty-string result and return next valid Git root", () => {
		// 最初のフォルダが空文字を返し、2番目のフォルダが有効なルートを返すケース
		mockExecFileSync
			.mockReturnValueOnce("\n")
			.mockReturnValueOnce("/workspace/repo\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/empty" } },
			{ uri: { fsPath: "/workspace/repo" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo");
		expect(mockExecFileSync).toHaveBeenCalledTimes(2);
	});

	it("should cache resolved git executable across multiple folders", () => {
		// 複数フォルダを連続して処理する際、resolveNativeExecutableOnPath は
		// 最初の有効な呼び出し時に一度だけ実行され、以後は使い回されること。
		// `resolveNativeExecutableOnPath` は I/O を伴うため、ループ毎に呼び直すと
		// 大量フォルダのワークスペースで余分なファイルシステムアクセスが走る。
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: not a git repository");
			})
			.mockImplementationOnce(() => {
				throw new Error("fatal: not a git repository");
			})
			.mockReturnValueOnce("/workspace/repo\n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/plain-a" } },
			{ uri: { fsPath: "/workspace/plain-b" } },
			{ uri: { fsPath: "/workspace/repo" } },
		] as never);

		expect(workspaceRoot).toBe("/workspace/repo");
		expect(mockResolveNativeExecutableOnPath).toHaveBeenCalledTimes(1);
		expect(mockExecFileSync).toHaveBeenCalledTimes(3);
	});

	it("should rethrow when safe git executable cannot be resolved during multi-folder iteration", () => {
		// 1 フォルダ目では Git 管理外を返してスキップしようとするが、
		// 実は git 実行ファイル自体が PATH 上にない場合、resolveGitExecutable が
		// 例外をスローする。これは ENOENT として伝搬し、後続フォルダで再試行しない。
		mockResolveNativeExecutableOnPath.mockReturnValue(null);

		expect(() =>
			getGitWorkspaceRoot([
				{ uri: { fsPath: "/workspace/plain-a" } },
				{ uri: { fsPath: "/workspace/repo" } },
			] as never),
		).toThrow("spawn git ENOENT");
		expect(mockExecFileSync).not.toHaveBeenCalled();
	});
});
