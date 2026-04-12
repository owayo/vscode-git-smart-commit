import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { execFileSync } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CommitInfo,
	getRecentCommits,
	rewordCommit,
} from "../commands/rewordCommit";

const mockSpawn = vi.fn();
const mockGetGitWorkspaceRoot = vi.fn();
const mockShowErrorMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockExecuteCommand = vi.fn();
const mockOpenExternal = vi.fn();
const mockParseUri = vi.fn((url: string) => url);

vi.mock("child_process", () => ({
	execFileSync: vi.fn(),
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../commands/getGitWorkspaceRoot", () => ({
	getGitWorkspaceRoot: (...args: unknown[]) => mockGetGitWorkspaceRoot(...args),
}));

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
		showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
		showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
		showInformationMessage: (...args: unknown[]) =>
			mockShowInformationMessage(...args),
		withProgress: (...args: unknown[]) => mockWithProgress(...args),
		createOutputChannel: vi.fn(() => ({
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		})),
		createStatusBarItem: vi.fn(() => ({
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		})),
	},
	workspace: {
		workspaceFolders: [{ uri: { fsPath: "/test/workspace" } }],
		getConfiguration: vi.fn(() => ({
			get: vi.fn(),
		})),
		onDidChangeConfiguration: vi.fn(),
	},
	commands: {
		registerCommand: vi.fn(),
		executeCommand: (...args: unknown[]) => mockExecuteCommand(...args),
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	ProgressLocation: { Notification: 15 },
	Uri: { parse: (url: string) => mockParseUri(url) },
	env: { openExternal: (...args: unknown[]) => mockOpenExternal(...args) },
}));

const mockExecFileSync = vi.mocked(execFileSync);

function createMockProcess(): ChildProcess & {
	__emit: (event: string, ...args: unknown[]) => void;
} {
	const proc = new EventEmitter() as ChildProcess & {
		__emit: (event: string, ...args: unknown[]) => void;
	};
	proc.stdout = new Readable({
		read() {},
	}) as unknown as ChildProcess["stdout"];
	proc.stderr = new Readable({
		read() {},
	}) as unknown as ChildProcess["stderr"];
	proc.kill = vi.fn();
	proc.__emit = (event: string, ...args: unknown[]) => {
		proc.emit(event, ...args);
	};
	return proc;
}

describe("getRecentCommits", () => {
	beforeEach(() => {
		vi.clearAllMocks();
		mockGetGitWorkspaceRoot.mockReturnValue("/test/workspace");
	});

	it("should parse git log output correctly", () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: add new feature\x002 hours ago\x00John Doe\x00def5678\x00fix: resolve bug\x001 day ago\x00Jane Smith\x00",
		);

		const commits = getRecentCommits("/workspace");

		expect(commits).toHaveLength(2);
		expect(commits[0]).toEqual<CommitInfo>({
			index: 1,
			hash: "abc1234",
			message: "feat: add new feature",
			date: "2 hours ago",
			author: "John Doe",
		});
		expect(commits[1]).toEqual<CommitInfo>({
			index: 2,
			hash: "def5678",
			message: "fix: resolve bug",
			date: "1 day ago",
			author: "Jane Smith",
		});
	});

	it("should throw on git log error", () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("not a git repository");
		});

		expect(() => getRecentCommits("/not-a-repo")).toThrow(
			"not a git repository",
		);
	});

	it("should return empty array when repository has no commits yet", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error(
					"fatal: your current branch 'main' does not have any commits yet",
				);
			})
			.mockReturnValueOnce("0\n");

		const commits = getRecentCommits("/workspace");

		expect(commits).toEqual([]);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			1,
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			2,
			"git",
			["rev-list", "--count", "--all"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should rethrow the original git log error when empty-history probe fails", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: bad revision 'HEAD'");
			})
			.mockImplementationOnce(() => {
				throw new Error("spawn git ENOENT");
			});

		expect(() => getRecentCommits("/workspace")).toThrow(
			"fatal: bad revision 'HEAD'",
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			1,
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			2,
			"git",
			["rev-list", "--count", "--all"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should return empty array for empty output", () => {
		mockExecFileSync.mockReturnValue("");

		const commits = getRecentCommits("/workspace");
		expect(commits).toEqual([]);
	});

	it("should respect the limit parameter", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", 5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "5"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should use default limit of 10", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace");

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when non-positive limit is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", 0);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should keep commit subjects that include pipes", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: support A|B|C\x001h ago\x00Author\x00",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0].message).toBe("feat: support A|B|C");
	});

	it("should keep commit subjects that include field separators", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: support A\x1fB\x001h ago\x00Author\x00",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0].message).toBe("feat: support A\x1fB");
		expect(commits[0].date).toBe("1h ago");
		expect(commits[0].author).toBe("Author");
	});

	it("should keep commit subjects that include record separators", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: support A\x1eB\x001h ago\x00Author\x00",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0].message).toBe("feat: support A\x1eB");
		expect(commits[0].date).toBe("1h ago");
		expect(commits[0].author).toBe("Author");
	});

	it("should use 1-based index for git-sc --reword", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00first\x001h ago\x00A\x00def\x00second\x002h ago\x00B\x00ghi\x00third\x003h ago\x00C\x00",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits[0].index).toBe(1);
		expect(commits[1].index).toBe(2);
		expect(commits[2].index).toBe(3);
	});

	it("should fallback to default limit when negative limit is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", -5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when float is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", 3.5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when NaN is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", Number.NaN);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should trim newline from hash when format: inserts separator between commits", () => {
		// format: はコミット間に改行セパレータを挿入するため、
		// 2番目以降のハッシュ先頭に改行が混入する → trim で除去する回帰テスト
		mockExecFileSync.mockReturnValue(
			"abc1234\x00first\x001h ago\x00Alice\x00\ndef5678\x00second\x002h ago\x00Bob\x00",
		);

		const commits = getRecentCommits("/workspace");

		expect(commits).toHaveLength(2);
		expect(commits[0].hash).toBe("abc1234");
		expect(commits[1].hash).toBe("def5678");
	});

	it("should use format: prefix to avoid tformat terminator newlines", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", 5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "5"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should rethrow git log error when getCommitCount returns non-numeric output", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: bad object HEAD");
			})
			// rev-list が非数値を返す場合（getCommitCount が null を返す）
			.mockReturnValueOnce("not-a-number\n");

		expect(() => getRecentCommits("/workspace")).toThrow(
			"fatal: bad object HEAD",
		);
	});

	it("should rethrow git log error when repository has commits (getCommitCount > 0)", () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: bad default revision 'HEAD'");
			})
			// rev-list がコミット数 > 0 を返す場合
			.mockReturnValueOnce("5\n");

		expect(() => getRecentCommits("/workspace")).toThrow(
			"fatal: bad default revision 'HEAD'",
		);
	});

	it("should strip newline separators from all hashes in 3+ commit output", () => {
		// 実際の git log --format=format: 出力を再現: コミット間に \n が挿入される
		mockExecFileSync.mockReturnValue(
			"aaa1111\x00first\x001h ago\x00Alice\x00\nbbb2222\x00second\x002h ago\x00Bob\x00\nccc3333\x00third\x003h ago\x00Carol\x00",
		);

		const commits = getRecentCommits("/workspace");

		expect(commits).toHaveLength(3);
		expect(commits[0].hash).toBe("aaa1111");
		expect(commits[1].hash).toBe("bbb2222");
		expect(commits[2].hash).toBe("ccc3333");
		// メッセージ・日付・著者が改行の影響を受けていないこと
		expect(commits[1].message).toBe("second");
		expect(commits[2].date).toBe("3h ago");
		expect(commits[2].author).toBe("Carol");
	});

	it("should handle single commit without newline separator issue", () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: single\x001h ago\x00Author\x00",
		);

		const commits = getRecentCommits("/workspace");

		expect(commits).toHaveLength(1);
		expect(commits[0].hash).toBe("abc1234");
	});

	it("should skip incomplete fields when output has fewer than 4 fields", () => {
		// ハッシュとメッセージのみ（日付・作者なし）→ コミットとして認識しない
		mockExecFileSync.mockReturnValue("abc1234\x00partial message\x00");

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(0);
	});

	it("should parse complete commits and ignore trailing incomplete fields", () => {
		// 1件の完全なコミット + 不完全なフィールド
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: complete\x002h ago\x00Author\x00def5678\x00orphan",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0].hash).toBe("abc1234");
	});

	it("should fallback to default limit when Infinity is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x00msg\x001h ago\x00Author\x00");

		getRecentCommits("/workspace", Number.POSITIVE_INFINITY);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should handle commit with empty fields gracefully", () => {
		mockExecFileSync.mockReturnValue("\x00\x00\x00\x00");

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0]).toEqual({
			index: 1,
			hash: "",
			message: "",
			date: "",
			author: "",
		});
	});
});

describe("rewordCommit", () => {
	let mockOutputChannel: {
		show: ReturnType<typeof vi.fn>;
		appendLine: ReturnType<typeof vi.fn>;
		append: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};

	beforeEach(() => {
		vi.clearAllMocks();
		mockGetGitWorkspaceRoot.mockReturnValue("/test/workspace");
		mockWithProgress.mockImplementation(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => unknown,
			) => {
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn(),
					isCancellationRequested: false,
				};
				return callback(progress, token);
			},
		);
		mockOutputChannel = {
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		};
	});

	it("should show error when no workspace folder is open", async () => {
		const vscode = await import("vscode");
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No workspace folder open",
		);

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: [{ uri: { fsPath: "/test/workspace" } }],
			writable: true,
			configurable: true,
		});
	});

	it("should show error when no Git repository is found in open workspace", async () => {
		mockGetGitWorkspaceRoot.mockReturnValue(null);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No Git repository found in open workspace",
		);
		expect(mockShowQuickPick).not.toHaveBeenCalled();
	});

	it("should show error when workspace folders is empty array", async () => {
		const vscode = await import("vscode");
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: [],
			writable: true,
			configurable: true,
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No workspace folder open",
		);

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: [{ uri: { fsPath: "/test/workspace" } }],
			writable: true,
			configurable: true,
		});
	});

	it("should show warning when no commits found", async () => {
		mockExecFileSync.mockReturnValue("");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowWarningMessage).toHaveBeenCalledWith(
			"No commits found in this repository",
		);
	});

	it("should show warning when repository has no commits yet", async () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error(
					"fatal: your current branch 'main' does not have any commits yet",
				);
			})
			.mockReturnValueOnce("0\n");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowWarningMessage).toHaveBeenCalledWith(
			"No commits found in this repository",
		);
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
		expect(mockShowQuickPick).not.toHaveBeenCalled();
	});

	it("should show git-not-found error when loading commits fails with ENOENT", async () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("spawn git ENOENT");
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git command not found. Please install Git and ensure it's in your PATH.",
		);
		expect(mockShowWarningMessage).not.toHaveBeenCalled();
		expect(mockShowQuickPick).not.toHaveBeenCalled();
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"\n❌ Failed to load commit history: spawn git ENOENT",
		);
	});

	it("should show generic history-load error when git log fails", async () => {
		mockExecFileSync.mockImplementation(() => {
			throw new Error("fatal: not a git repository");
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to load commit history: fatal: not a git repository",
		);
		expect(mockShowWarningMessage).not.toHaveBeenCalled();
		expect(mockShowQuickPick).not.toHaveBeenCalled();
	});

	it("should preserve the original history-load error when commit count probe fails", async () => {
		mockExecFileSync
			.mockImplementationOnce(() => {
				throw new Error("fatal: bad revision 'HEAD'");
			})
			.mockImplementationOnce(() => {
				throw new Error("spawn git ENOENT");
			});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to load commit history: fatal: bad revision 'HEAD'",
		);
		expect(mockShowWarningMessage).not.toHaveBeenCalled();
		expect(mockShowQuickPick).not.toHaveBeenCalled();
		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"\n❌ Failed to load commit history: fatal: bad revision 'HEAD'",
		);
	});

	it("should show 0 commit(s) ago for the latest commit in selection", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: latest\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) => {
			const firstItem = items[0] as { detail?: string };
			expect(firstItem.detail).toContain("0 commit(s) ago");
			return Promise.resolve(undefined);
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should truncate long commit message in confirmation dialog", async () => {
		const longMessage = "feat: ".padEnd(60, "x");
		mockExecFileSync.mockReturnValue(
			`abc\x00${longMessage}\x001h ago\x00Author\x00`,
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		// 確認ダイアログの placeHolder に "..." が含まれることを検証
		mockShowQuickPick.mockImplementationOnce(
			(_items: unknown[], options: { placeHolder?: string }) => {
				expect(options.placeHolder).toContain("...");
				expect(options.placeHolder).toMatch(/.{50}\.\.\."?\?$/);
				return Promise.resolve("No");
			},
		);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
	});

	it("should not truncate short commit message in confirmation dialog", async () => {
		const shortMessage = "fix: short";
		mockExecFileSync.mockReturnValue(
			`abc\x00${shortMessage}\x001h ago\x00Author\x00`,
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockImplementationOnce(
			(_items: unknown[], options: { placeHolder?: string }) => {
				expect(options.placeHolder).not.toContain("...");
				expect(options.placeHolder).toContain(shortMessage);
				return Promise.resolve("No");
			},
		);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
	});

	it("should return when user cancels commit selection", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockResolvedValueOnce(undefined);

		await rewordCommit(mockOutputChannel as never);

		// QuickPick はコミット選択の 1 回だけ（確認ダイアログは出ない）
		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should return when user cancels confirmation dialog with escape", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		// 確認ダイアログで Escape を押した場合（undefined が返る）
		mockShowQuickPick.mockResolvedValueOnce(undefined);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
		expect(mockWithProgress).not.toHaveBeenCalled();
	});

	it("should return when user declines confirmation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: test\x001h ago\x00Author\x00",
		);
		// 1 回目の QuickPick は候補先頭を選択
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		// 2 回目の QuickPick では確認を拒否
		mockShowQuickPick.mockResolvedValueOnce("No");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
		expect(mockWithProgress).not.toHaveBeenCalled();
	});

	it("should run git-sc reword after selection and confirmation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["--reword", "abc1234", "-y"],
			expect.objectContaining({
				cwd: "/test/workspace",
				shell: true,
			}),
		);
		expect(mockShowInformationMessage).toHaveBeenCalledWith(
			"Commit reworded successfully!",
		);
		expect(mockExecuteCommand).toHaveBeenCalledWith("git.refresh");
	});

	it("should use the resolved Git workspace root for reword", async () => {
		mockGetGitWorkspaceRoot.mockReturnValue("/test/repo");
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["--reword", "abc1234", "-y"],
			expect.objectContaining({
				cwd: "/test/repo",
				shell: true,
			}),
		);
	});

	it("should show installation link when reword fails with Windows command-not-found message", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		mockShowErrorMessage.mockResolvedValue("View Installation");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit(
				"data",
				Buffer.from(
					"'git-sc' is not recognized as an internal or external command",
				),
			);
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
	});

	it("should open installation page when user selects installation link after reword failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		mockShowErrorMessage.mockResolvedValue("View Installation");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 127), 10);

		await expect(promise).rejects.toThrow();
		expect(mockParseUri).toHaveBeenCalledWith(
			"https://github.com/owayo/git-smart-commit#installation",
		);
		expect(mockOpenExternal).toHaveBeenCalledWith(
			"https://github.com/owayo/git-smart-commit#installation",
		);
	});

	it("should handle reword spawn error (ENOENT)", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		mockShowErrorMessage.mockResolvedValue(undefined);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(
			() => proc.__emit("error", new Error("spawn git-sc ENOENT")),
			10,
		);

		await expect(promise).rejects.toThrow("ENOENT");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
	});

	it("should handle reword non-zero exit code", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("rebase failed"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("rebase failed");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Reword failed: rebase failed",
		);
	});

	it("should handle reword non-ENOENT spawn error", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("error", new Error("spawn EACCES")), 10);

		await expect(promise).rejects.toThrow("EACCES");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to run git-sc: spawn EACCES",
		);
	});

	it("should resolve safely when error fires after reword cancellation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => Promise<void>,
			) => {
				let cancelHandler: (() => void) | undefined;
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn((handler: () => void) => {
						cancelHandler = handler;
					}),
					isCancellationRequested: false,
				};

				const progressPromise = callback(progress, token);
				// キャンセル後に error イベントが発火するケース
				cancelHandler?.();
				setTimeout(() => proc.__emit("error", new Error("killed")), 10);
				return progressPromise;
			},
		);

		await expect(
			rewordCommit(mockOutputChannel as never),
		).resolves.toBeUndefined();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should show fallback exit code message when reword stderr and stdout are empty", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 42), 10);

		await expect(promise).rejects.toThrow("Process exited with code 42");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Reword failed: Process exited with code 42",
		);
	});

	it("should resolve safely when close fires after reword cancellation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => Promise<void>,
			) => {
				let cancelHandler: (() => void) | undefined;
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn((handler: () => void) => {
						cancelHandler = handler;
					}),
					isCancellationRequested: false,
				};

				const progressPromise = callback(progress, token);
				// キャンセル後に close イベントが非ゼロコードで発火するケース
				cancelHandler?.();
				setTimeout(() => proc.__emit("close", 1), 10);
				return progressPromise;
			},
		);

		await expect(
			rewordCommit(mockOutputChannel as never),
		).resolves.toBeUndefined();
		expect(proc.kill).toHaveBeenCalled();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should not show error when reword is cancelled", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => Promise<void>,
			) => {
				let cancelHandler: (() => void) | undefined;
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn((handler: () => void) => {
						cancelHandler = handler;
					}),
					isCancellationRequested: false,
				};

				const progressPromise = callback(progress, token);
				cancelHandler?.();
				setTimeout(() => proc.__emit("close", null), 10);
				return progressPromise;
			},
		);

		await expect(
			rewordCommit(mockOutputChannel as never),
		).resolves.toBeUndefined();
		expect(proc.kill).toHaveBeenCalled();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should call getRecentCommits with limit of 15", async () => {
		mockExecFileSync.mockReturnValue("");

		await rewordCommit(mockOutputChannel as never);

		// git log コマンドの -n 引数が 15 であることを検証
		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=format:%h%x00%s%x00%cr%x00%an%x00", "-n", "15"],
			expect.objectContaining({ encoding: "utf-8" }),
		);
	});

	it("should capture reword stdout output", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stdout?.emit("data", Buffer.from("reword output"));
			proc.__emit("close", 0);
		}, 10);
		await promise;

		expect(mockOutputChannel.append).toHaveBeenCalledWith("reword output");
	});

	it("should capture reword stderr output", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("reword warning"));
			proc.__emit("close", 0);
		}, 10);
		await promise;

		expect(mockOutputChannel.append).toHaveBeenCalledWith("reword warning");
	});

	it("should show git-not-found error when getGitWorkspaceRoot throws ENOENT", async () => {
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw new Error("spawn git ENOENT");
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git command not found. Please install Git and ensure it's in your PATH.",
		);
		expect(mockShowQuickPick).not.toHaveBeenCalled();
	});

	it("should show generic error when getGitWorkspaceRoot throws non-ENOENT error", async () => {
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw new Error(
				"fatal: unsafe repository ('/repo' is owned by someone else)",
			);
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to detect Git repository: fatal: unsafe repository ('/repo' is owned by someone else)",
		);
		expect(mockShowQuickPick).not.toHaveBeenCalled();
	});

	it("should use stdout as reword error message when stderr is empty on failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stdout?.emit("data", Buffer.from("stdout reword detail"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("stdout reword detail");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Reword failed: stdout reword detail",
		);
	});

	it("should not open external URL when user dismisses installation dialog after reword failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		// ユーザーがダイアログを閉じた場合（undefined が返る）
		mockShowErrorMessage.mockResolvedValue(undefined);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 127), 10);

		await expect(promise).rejects.toThrow();
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
		expect(mockOpenExternal).not.toHaveBeenCalled();
	});

	it("should report progress message with commit hash during reword", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		const mockProgressReport = vi.fn();

		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => unknown,
			) => {
				const progress = { report: mockProgressReport };
				const token = {
					onCancellationRequested: vi.fn(),
					isCancellationRequested: false,
				};
				return callback(progress, token);
			},
		);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockProgressReport).toHaveBeenCalledWith({
			message: "Rewording commit abc1234...",
		});
	});

	it("should set FORCE_COLOR=0 in reword process env", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			expect.any(Array),
			expect.objectContaining({
				env: expect.objectContaining({ FORCE_COLOR: "0" }),
			}),
		);
	});

	it("should truncate long reword error message to 100 characters", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		const longError = "y".repeat(200);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from(longError));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();
		// エラーメッセージが 100 文字で切り詰められていることを検証
		const errorArg = mockShowErrorMessage.mock.calls[0][0] as string;
		expect(errorArg).toBe(`Reword failed: ${"y".repeat(100)}`);
	});

	it("should pass matchOnDescription and matchOnDetail to QuickPick", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce(
			(_items: unknown[], options: Record<string, unknown>) => {
				expect(options.matchOnDescription).toBe(true);
				expect(options.matchOnDetail).toBe(true);
				return Promise.resolve(undefined);
			},
		);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should format QuickPick item label with git-commit icon prefix", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: nice feature\x002h ago\x00Alice\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) => {
			const item = (items as Array<{ label: string; description: string }>)[0];
			expect(item.label).toBe("$(git-commit) feat: nice feature");
			expect(item.description).toBe("abc1234 • 2h ago");
			return Promise.resolve(undefined);
		});

		await rewordCommit(mockOutputChannel as never);
	});

	it("should truncate long getGitWorkspaceRoot error message to 100 characters", async () => {
		const longError = "z".repeat(200);
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw new Error(longError);
		});

		await rewordCommit(mockOutputChannel as never);

		const errorArg = mockShowErrorMessage.mock.calls[0][0] as string;
		expect(errorArg).toBe(
			`Failed to detect Git repository: ${"z".repeat(100)}`,
		);
	});

	it("should pass correct items and title to confirmation QuickPick", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockImplementationOnce(
			(items: unknown[], options: { title?: string }) => {
				// 確認ダイアログの選択肢が ["Yes", "No"] であること
				expect(items).toEqual(["Yes", "No"]);
				expect(options.title).toBe("Confirm Reword");
				return Promise.resolve("No");
			},
		);

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
	});

	it("should pass correct placeHolder and title to commit selection QuickPick", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce(
			(_items: unknown[], options: Record<string, unknown>) => {
				expect(options.placeHolder).toBe("Select a commit to reword");
				expect(options.title).toBe("Git Smart Commit: Reword");
				return Promise.resolve(undefined);
			},
		);

		await rewordCommit(mockOutputChannel as never);
	});

	it("should call outputChannel.show with preserveFocus=true before reword spawn", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
	});

	it("should write success marker to outputChannel on reword completion", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("✅ Reword completed successfully")),
		).toBe(true);
	});

	it("should write failure marker to outputChannel on reword failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("error"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("❌ Reword failed with code 1"))).toBe(
			true,
		);
	});

	it("should write cancellation marker to outputChannel when reword is cancelled", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => Promise<void>,
			) => {
				let cancelHandler: (() => void) | undefined;
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn((handler: () => void) => {
						cancelHandler = handler;
					}),
					isCancellationRequested: false,
				};

				const progressPromise = callback(progress, token);
				cancelHandler?.();
				setTimeout(() => proc.__emit("close", null), 10);
				return progressPromise;
			},
		);

		await rewordCommit(mockOutputChannel as never);

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("⚠️ Reword cancelled by user"))).toBe(
			true,
		);
	});

	it("should not call git.refresh on reword failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("error"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockExecuteCommand).not.toHaveBeenCalledWith("git.refresh");
	});

	it("should accumulate chunked stderr in reword and use full message on failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("err1"));
			proc.stderr?.emit("data", Buffer.from("err2"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("err1err2");
	});

	it("should write header lines to outputChannel before reword spawn", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		// ヘッダー区切り線、実行コマンド、作業ディレクトリの出力を検証
		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("=".repeat(50)))).toBe(true);
		expect(
			calls.some((c) => c.includes("Running: git-sc --reword abc1234 -y")),
		).toBe(true);
		expect(
			calls.some((c) => c.includes("Working directory: /test/workspace")),
		).toBe(true);
	});

	it("should call withProgress with correct options for reword", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockWithProgress).toHaveBeenCalledWith(
			{
				location: 15, // ProgressLocation.Notification
				title: "Git Smart Commit",
				cancellable: true,
			},
			expect.any(Function),
		);
	});

	it("should treat null exit code as failure when reword is not cancelled", async () => {
		// プロセスがシグナルで終了し code が null になるケース（キャンセル以外）
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("close", null), 10);

		await expect(promise).rejects.toThrow("Process exited with code null");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Reword failed: Process exited with code null",
		);
	});

	it("should write spawn error marker to outputChannel on reword spawn failure", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x00feat: test\x001h ago\x00Author\x00",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		mockShowQuickPick.mockResolvedValueOnce("Yes");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = rewordCommit(mockOutputChannel as never);
		setTimeout(() => proc.__emit("error", new Error("spawn EACCES")), 10);

		await expect(promise).rejects.toThrow();

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("❌ Failed to start git-sc: spawn EACCES")),
		).toBe(true);
	});
});
