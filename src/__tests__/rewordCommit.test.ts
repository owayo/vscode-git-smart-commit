import { execSync } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
	type CommitInfo,
	getRecentCommits,
	rewordCommit,
} from "../commands/rewordCommit";

const mockShowErrorMessage = vi.fn();
const mockShowWarningMessage = vi.fn();
const mockShowQuickPick = vi.fn();
const mockWithProgress = vi.fn();

vi.mock("child_process", () => ({
	execSync: vi.fn(),
	spawn: vi.fn(),
}));

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
		showWarningMessage: (...args: unknown[]) => mockShowWarningMessage(...args),
		showQuickPick: (...args: unknown[]) => mockShowQuickPick(...args),
		showInformationMessage: vi.fn(),
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
		executeCommand: vi.fn(),
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	ProgressLocation: { Notification: 15 },
	Uri: { parse: vi.fn() },
	env: { openExternal: vi.fn() },
}));

const mockExecSync = vi.mocked(execSync);

describe("getRecentCommits", () => {
	it("should parse git log output correctly", () => {
		mockExecSync.mockReturnValue(
			"abc1234|feat: add new feature|2 hours ago|John Doe\ndef5678|fix: resolve bug|1 day ago|Jane Smith\n",
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

	it("should return empty array on error", () => {
		mockExecSync.mockImplementation(() => {
			throw new Error("not a git repository");
		});

		const commits = getRecentCommits("/not-a-repo");
		expect(commits).toEqual([]);
	});

	it("should return empty array for empty output", () => {
		mockExecSync.mockReturnValue("");

		const commits = getRecentCommits("/workspace");
		expect(commits).toEqual([]);
	});

	it("should respect the limit parameter", () => {
		mockExecSync.mockReturnValue("abc|msg|1h ago|Author\n");

		getRecentCommits("/workspace", 5);

		expect(mockExecSync).toHaveBeenCalledWith(
			'git log --oneline --format="%h|%s|%cr|%an" -n 5',
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should use default limit of 10", () => {
		mockExecSync.mockReturnValue("abc|msg|1h ago|Author\n");

		getRecentCommits("/workspace");

		expect(mockExecSync).toHaveBeenCalledWith(
			'git log --oneline --format="%h|%s|%cr|%an" -n 10',
			{ cwd: "/workspace", encoding: "utf-8" },
		);
	});

	it("should filter empty lines", () => {
		mockExecSync.mockReturnValue(
			"abc|msg1|1h ago|Author\n\ndef|msg2|2h ago|Author\n",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits).toHaveLength(2);
	});

	it("should use 1-based index for git-sc --reword", () => {
		mockExecSync.mockReturnValue(
			"abc|first|1h ago|A\ndef|second|2h ago|B\nghi|third|3h ago|C\n",
		);

		const commits = getRecentCommits("/workspace");
		expect(commits[0].index).toBe(1);
		expect(commits[1].index).toBe(2);
		expect(commits[2].index).toBe(3);
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
		mockExecSync.mockReturnValue("");

		await rewordCommit(mockOutputChannel as never);

		expect(mockShowWarningMessage).toHaveBeenCalledWith(
			"No commits found in this repository",
		);
	});

	it("should return when user cancels commit selection", async () => {
		mockExecSync.mockReturnValue("abc|feat: test|1h ago|Author\n");
		mockShowQuickPick.mockResolvedValueOnce(undefined);

		await rewordCommit(mockOutputChannel as never);

		// Only one QuickPick call (commit selection), no confirmation
		expect(mockShowQuickPick).toHaveBeenCalledTimes(1);
	});

	it("should return when user declines confirmation", async () => {
		mockExecSync.mockReturnValue("abc|feat: test|1h ago|Author\n");
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
});
