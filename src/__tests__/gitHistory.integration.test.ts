import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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

	it("空リポジトリは空の履歴として返す", async () => {
		expect(await getRecentCommits(empty)).toEqual([]);
	});

	it("通常の履歴を新しい順で返す", async () => {
		expect(
			(await getRecentCommits(populated)).map((commit) => commit.message),
		).toEqual(["second", "first"]);
	});

	it("SCM から指定されたリポジトリを先頭のワークスペースより優先する", async () => {
		expect(
			await getGitWorkspaceRoot(
				[{ uri: { fsPath: empty } }] as never,
				{ fsPath: populated } as never,
			),
		).toBe(git(populated, ["rev-parse", "--show-toplevel"]).trim());
	});

	it("SCM の対象が削除済みでも別のリポジトリを選ばない", async () => {
		expect(
			await getGitWorkspaceRoot(
				[{ uri: { fsPath: populated } }] as never,
				{ fsPath: join(root, "missing-scm-repository") } as never,
			),
		).toBeNull();
	});

	it("署名表示が有効でも検証結果をコミットハッシュへ混入させない", async () => {
		const signed = join(root, "signed");
		mkdirSync(signed);
		git(signed, ["init", "-b", "main"]);
		const tree = git(signed, ["mktree"]).trim();
		// 署名検証できない履歴も、秘密鍵や検証コマンドを必要とせず再現する。
		// Git の SSH 署名表示は検証失敗の診断も stdout へ出す。
		const rawCommit = [
			`tree ${tree}`,
			"author Test Author <you@example.com> 1700000000 +0000",
			"committer Test Author <you@example.com> 1700000000 +0000",
			"gpgsig -----BEGIN SSH SIGNATURE-----",
			" invalid",
			" -----END SSH SIGNATURE-----",
			"",
			"signed subject",
			"",
		].join("\n");
		const hash = execFileSync(
			gitCommand,
			["-C", signed, "hash-object", "-t", "commit", "-w", "--stdin"],
			{ input: rawCommit, encoding: "utf8" },
		).trim();
		git(signed, ["update-ref", "refs/heads/main", hash]);
		git(signed, ["config", "log.showSignature", "true"]);
		git(signed, [
			"config",
			"gpg.ssh.allowedSignersFile",
			process.platform === "win32" ? "NUL" : "/dev/null",
		]);

		const commits = await getRecentCommits(signed);
		expect(commits).toHaveLength(1);
		expect(commits[0]?.hash).toBe(git(signed, ["rev-parse", "HEAD"]).trim());
		expect(commits[0]?.shortHash).toBe(
			git(signed, ["rev-parse", "--short", "HEAD"]).trim(),
		);
		expect(commits[0]?.message).toBe("signed subject");
		expect(commits[0]?.author).toBe("Test Author");
	});

	it("短縮ハッシュと同名のタグがあっても、選んだコミットに解決できるハッシュを返す", async () => {
		const ambiguous = join(root, "ambiguous");
		mkdirSync(ambiguous);
		git(ambiguous, ["init", "-b", "main"]);
		for (const message of ["target", "other"]) {
			git(ambiguous, [
				"-c",
				"commit.gpgsign=false",
				"commit",
				"--allow-empty",
				"-m",
				message,
			]);
		}
		const target = git(ambiguous, ["rev-parse", "HEAD~1"]).trim();
		const other = git(ambiguous, ["rev-parse", "HEAD"]).trim();
		const targetShortHash = git(ambiguous, [
			"rev-parse",
			"--short",
			"HEAD~1",
		]).trim();
		// target の短縮ハッシュと同じ名前のタグを other に付ける。
		// git rev-parse は短縮ハッシュより ref 名を先に解決するため、短縮形では other になる。
		git(ambiguous, ["tag", targetShortHash, other]);
		expect(
			git(ambiguous, [
				"rev-parse",
				"--verify",
				"--quiet",
				`${targetShortHash}^{commit}`,
			]).trim(),
		).toBe(other);

		const selected = (await getRecentCommits(ambiguous)).find(
			(commit) => commit.message === "target",
		);

		expect(selected?.hash).toBe(target);
		// git-sc --reword と同じ解決方法で、選んだコミット自体に解決されること
		expect(
			git(ambiguous, [
				"rev-parse",
				"--verify",
				"--quiet",
				"--end-of-options",
				`${selected?.hash}^{commit}`,
			]).trim(),
		).toBe(target);
	});

	it("i18n.logOutputEncoding が UTF-8 以外でも件名と作者名を文字化けさせない", async () => {
		const encoded = join(root, "encoded");
		mkdirSync(encoded);
		git(encoded, ["init", "-b", "main"]);
		git(encoded, [
			"-c",
			"commit.gpgsign=false",
			"commit",
			"--allow-empty",
			"-m",
			"日本語の件名",
			"--author",
			"山田 <you@example.com>",
		]);
		git(encoded, ["config", "i18n.logOutputEncoding", "Shift_JIS"]);

		const commits = await getRecentCommits(encoded);

		expect(commits).toHaveLength(1);
		expect(commits[0]?.message).toBe("日本語の件名");
		expect(commits[0]?.author).toBe("山田");
	});

	it("orphan HEAD に他の ref の履歴があれば元の git log エラーを保持する", async () => {
		git(populated, ["symbolic-ref", "HEAD", "refs/heads/unborn"]);
		try {
			await expect(getRecentCommits(populated)).rejects.toThrow(
				/does not have any commits yet|bad default revision/,
			);
		} finally {
			git(populated, ["symbolic-ref", "HEAD", "refs/heads/main"]);
		}
	});

	it("削除済みとファイル化した候補の後にある正常なリポジトリを検出する", async () => {
		const file = join(root, "file");
		writeFileSync(file, "test");
		expect(
			await getGitWorkspaceRoot([
				{ uri: { fsPath: join(root, "missing") } },
				{ uri: { fsPath: file } },
				{ uri: { fsPath: populated, scheme: "vscode-remote" } },
			] as never),
		).toBe(git(populated, ["rev-parse", "--show-toplevel"]).trim());
	});
});
