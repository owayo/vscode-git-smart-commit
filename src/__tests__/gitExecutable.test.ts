import { beforeEach, describe, expect, it, vi } from "vitest";
import { execGit, resolveGitExecutable } from "../commands/gitExecutable";

const mockExecFile = vi.fn();
const mockResolveNativeExecutableOnPath = vi.fn();

vi.mock("child_process", () => ({
	execFile: (...args: unknown[]) => mockExecFile(...args),
}));

vi.mock("../commands/resolveExecutablePath", () => ({
	resolveNativeExecutableOnPath: (...args: unknown[]) =>
		mockResolveNativeExecutableOnPath(...args),
}));

type ExecFileCallback = (
	error: Error | null,
	stdout: string,
	stderr: string,
) => void;

describe("resolveGitExecutable", () => {
	beforeEach(() => {
		vi.clearAllMocks();
	});

	it("PATH 上の native な git の絶対パスを返す", () => {
		mockResolveNativeExecutableOnPath.mockReturnValue("/usr/bin/git");

		expect(resolveGitExecutable()).toBe("/usr/bin/git");
		expect(mockResolveNativeExecutableOnPath).toHaveBeenCalledWith("git");
	});

	it("見つからなければ起動失敗と同じ ENOENT のコード付きエラーを投げる", () => {
		mockResolveNativeExecutableOnPath.mockReturnValue(null);

		let thrown: unknown;
		try {
			resolveGitExecutable();
		} catch (error) {
			thrown = error;
		}
		// 呼び出し元はメッセージではなくコードで Git 未導入を判定する
		expect(thrown).toBeInstanceOf(Error);
		expect(thrown).toMatchObject({
			message: "spawn git ENOENT",
			code: "ENOENT",
		});
	});
});

describe("execGit", () => {
	let callback: ExecFileCallback | undefined;
	let stdinEnd: ReturnType<typeof vi.fn>;

	beforeEach(() => {
		vi.clearAllMocks();
		callback = undefined;
		stdinEnd = vi.fn();
		// 終了の通知を保留し、完了前の振る舞いを確かめられるようにする
		mockExecFile.mockImplementation(
			(
				_file: string,
				_args: string[],
				_options: unknown,
				done: ExecFileCallback,
			) => {
				callback = done;
				return { stdin: { end: stdinEnd } };
			},
		);
	});

	it("絶対パスと引数を UTF-8 で渡し、完了を待たずに標準入力を閉じる", async () => {
		const pending = execGit("/usr/bin/git", ["-C", "/repo", "log"]);

		expect(mockExecFile).toHaveBeenCalledWith(
			"/usr/bin/git",
			["-C", "/repo", "log"],
			{ encoding: "utf-8" },
			expect.any(Function),
		);
		// Git に標準入力を待たせない (同期版で stdin を ignore にしていたのと同じ扱い)
		expect(stdinEnd).toHaveBeenCalledTimes(1);

		callback?.(null, "abc\n", "");
		await expect(pending).resolves.toBe("abc\n");
	});

	it("指定した環境変数をそのまま渡す", async () => {
		const env = { PATH: "/usr/bin", LC_ALL: "C" };
		const pending = execGit("/usr/bin/git", ["rev-parse"], { env });

		expect(mockExecFile).toHaveBeenCalledWith(
			"/usr/bin/git",
			["rev-parse"],
			{ encoding: "utf-8", env },
			expect.any(Function),
		);

		callback?.(null, "", "");
		await pending;
	});

	it("失敗したら終了コード・標準出力・標準エラーを持つエラーで reject する", async () => {
		const pending = execGit("/usr/bin/git", ["rev-parse"]);
		const failure = Object.assign(
			new Error(
				"Command failed: /usr/bin/git rev-parse\nfatal: not a git repository",
			),
			{ code: 128 },
		);

		callback?.(failure, "partial", "fatal: not a git repository\n");

		await expect(pending).rejects.toBe(failure);
		await expect(pending).rejects.toMatchObject({
			code: 128,
			stdout: "partial",
			stderr: "fatal: not a git repository\n",
		});
	});
});
