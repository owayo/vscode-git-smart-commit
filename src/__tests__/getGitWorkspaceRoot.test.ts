import { execFileSync } from "child_process";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getGitWorkspaceRoot } from "../commands/getGitWorkspaceRoot";

vi.mock("child_process", () => ({
	execFileSync: vi.fn(),
}));

const mockExecFileSync = vi.mocked(execFileSync);

describe("getGitWorkspaceRoot", () => {
	beforeEach(() => {
		vi.clearAllMocks();
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
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			1,
			"git",
			["rev-parse", "--show-toplevel"],
			{
				cwd: "/workspace/plain",
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			2,
			"git",
			["rev-parse", "--show-toplevel"],
			{
				cwd: "/workspace/repo/packages/app",
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "pipe"],
			},
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
		mockExecFileSync.mockReturnValueOnce("  \n");

		const workspaceRoot = getGitWorkspaceRoot([
			{ uri: { fsPath: "/workspace/folder" } },
		] as never);

		expect(workspaceRoot).toBeNull();
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
});
