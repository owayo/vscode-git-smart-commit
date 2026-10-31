import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { getGitWorkspaceRoot } from "../commands/getGitWorkspaceRoot";
import { resolveGitExecutable } from "../commands/gitExecutable";
import { getRecentCommits } from "../commands/rewordCommit";

vi.mock("vscode", () => ({}));

describe("実際の Git による履歴とワークスペース検出", () => {
	let root: string;
	let empty: string;
	let populated: string;
	let gitCommand: string;

	function git(repo: string, args: string[]): string {
		return execFileSync(gitCommand, ["-C", repo, ...args], {
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
		});
	}

	beforeAll(() => {
		root = mkdtempSync(join(tmpdir(), "git-history-test-"));
		gitCommand = resolveGitExecutable();
		for (const key of Object.keys(process.env)) {
			if (key.startsWith("GIT_")) vi.stubEnv(key, undefined);
		}
		vi.stubEnv(
			"GIT_CONFIG_GLOBAL",
			process.platform === "win32" ? "NUL" : "/dev/null",
		);
		vi.stubEnv("GIT_CONFIG_NOSYSTEM", "1");
		vi.stubEnv("LC_ALL", "C");
		vi.stubEnv("GIT_AUTHOR_NAME", "Test Author");
		vi.stubEnv("GIT_AUTHOR_EMAIL", "you@example.com");
		vi.stubEnv("GIT_COMMITTER_NAME", "Test Author");
		vi.stubEnv("GIT_COMMITTER_EMAIL", "you@example.com");
		empty = join(root, "empty");
		populated = join(root, "populated");
		for (const repo of [empty, populated]) {
			mkdirSync(repo);
			git(repo, ["init", "-b", "main"]);
		}
		for (const message of ["first", "second"]) {
			git(populated, [
				"-c",
				"commit.gpgsign=false",
				"commit",
				"--allow-empty",
				"-m",
				message,
			]);
		}
	}, 30000);

	afterAll(() => {
		vi.unstubAllEnvs();
		if (root) rmSync(root, { recursive: true, force: true });
	});

	it("空リポジトリは空の履歴として返す", () => {
		expect(getRecentCommits(empty)).toEqual([]);
	});

	it("通常の履歴を新しい順で返す", () => {
		expect(getRecentCommits(populated).map((commit) => commit.message)).toEqual(
			["second", "first"],
		);
	});

	it("orphan HEAD に他の ref の履歴があれば元の git log エラーを保持する", () => {
		git(populated, ["symbolic-ref", "HEAD", "refs/heads/unborn"]);
		try {
			expect(() => getRecentCommits(populated)).toThrow(
				/does not have any commits yet|bad default revision/,
			);
		} finally {
			git(populated, ["symbolic-ref", "HEAD", "refs/heads/main"]);
		}
	});

	it("削除済みとファイル化した候補の後にある正常なリポジトリを検出する", () => {
		const file = join(root, "file");
		writeFileSync(file, "test");
		expect(
			getGitWorkspaceRoot([
				{ uri: { fsPath: join(root, "missing") } },
				{ uri: { fsPath: file } },
				{ uri: { fsPath: populated, scheme: "vscode-remote" } },
			] as never),
		).toBe(git(populated, ["rev-parse", "--show-toplevel"]).trim());
	});
});
