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
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
		expect(mockExecFileSync).toHaveBeenNthCalledWith(
			2,
			"git",
			["rev-parse", "--show-toplevel"],
			{
				cwd: "/workspace/repo/packages/app",
				encoding: "utf-8",
				stdio: ["ignore", "pipe", "ignore"],
			},
		);
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
});
