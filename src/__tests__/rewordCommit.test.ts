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
const mockShowErrorMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockExecuteCommand = vi.fn();

vi.mock("child_process", () => ({
	execFileSync: vi.fn(),
	spawn: (...args: unknown[]) => mockSpawn(...args),
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
	Uri: { parse: vi.fn() },
	env: { openExternal: vi.fn() },
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
	it("should parse git log output correctly", () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x1ffeat: add new feature\x1f2 hours ago\x1fJohn Doe\x1edef5678\x1ffix: resolve bug\x1f1 day ago\x1fJane Smith\x1e",
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

	it("should return empty array for empty output", () => {
		mockExecFileSync.mockReturnValue("");

		const commits = getRecentCommits("/workspace");
		expect(commits).toEqual([]);
	});

	it("should respect the limit parameter", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace", 5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "5"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should use default limit of 10", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace");

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when non-positive limit is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace", 0);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should keep commit subjects that include pipes", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x1ffeat: support A|B|C\x1f1h ago\x1fAuthor\x1e",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(1);
		expect(commits[0].message).toBe("feat: support A|B|C");
	});

	it("should use 1-based index for git-sc --reword", () => {
		mockExecFileSync.mockReturnValue(
			"abc\x1ffirst\x1f1h ago\x1fA\x1edef\x1fsecond\x1f2h ago\x1fB\x1eghi\x1fthird\x1f3h ago\x1fC\x1e",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits[0].index).toBe(1);
		expect(commits[1].index).toBe(2);
		expect(commits[2].index).toBe(3);
	});

	it("should fallback to default limit when negative limit is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace", -5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when float is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace", 3.5);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should fallback to default limit when NaN is passed", () => {
		mockExecFileSync.mockReturnValue("abc\x1fmsg\x1f1h ago\x1fAuthor\x1e");

		getRecentCommits("/workspace", Number.NaN);

		expect(mockExecFileSync).toHaveBeenCalledWith(
			"git",
			["log", "--format=%h\x1f%s\x1f%cr\x1f%an\x1e", "-n", "10"],
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should handle commit with empty fields gracefully", () => {
		mockExecFileSync.mockReturnValue("\x1f\x1f\x1f\x1e");

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

	it("should show warning when no commits found", async () => {
		mockExecFileSync.mockReturnValue("");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowWarningMessage).toHaveBeenCalledWith(
			"No commits found in this repository",
		);
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

	it("should show 0 commit(s) ago for the latest commit in selection", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x1ffeat: latest\x1f1h ago\x1fAuthor\x1e",
		);
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) => {
			const firstItem = items[0] as { detail?: string };
			expect(firstItem.detail).toContain("0 commit(s) ago");
			return Promise.resolve(undefined);
		});

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should return when user cancels commit selection", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
		);
		mockShowQuickPick.mockResolvedValueOnce(undefined);

		await rewordCommit(mockOutputChannel as never);

		// Only one QuickPick call (commit selection), no confirmation
		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should return when user declines confirmation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
		);
		// First QuickPick: return the first item from the passed items array
		mockShowQuickPick.mockImplementationOnce((items: unknown[]) =>
			Promise.resolve(items[0]),
		);
		// Second QuickPick: decline confirmation
		mockShowQuickPick.mockResolvedValueOnce("No");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowQuickPick).toHaveBeenCalledTimes(2);
		expect(mockWithProgress).not.toHaveBeenCalled();
	});

	it("should run git-sc reword after selection and confirmation", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
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

	it("should show installation link when reword fails with Windows command-not-found message", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
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

	it("should handle reword spawn error (ENOENT)", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
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
			"abc1234\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
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

	it("should not show error when reword is cancelled", async () => {
		mockExecFileSync.mockReturnValue(
			"abc1234\x1ffeat: test\x1f1h ago\x1fAuthor\x1e",
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
});
