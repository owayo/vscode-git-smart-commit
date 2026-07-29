import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();
const mockGetGitWorkspaceRoot = vi.fn();
const TASKKILL_COMMAND = "C:\\Windows\\System32\\taskkill.exe";

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
	execSync: vi.fn(),
}));

vi.mock("../commands/getGitWorkspaceRoot", () => ({
	getGitWorkspaceRoot: (...args: unknown[]) => mockGetGitWorkspaceRoot(...args),
}));

// Windows シミュレートテストでは PATH 走査の副作用を避けたいので、
// `resolveSpawnCommand` はこのテスト専用の固定値を返す。
// テストごとに `mockResolveSpawnCommand.mockReturnValueOnce(null)` 等で個別オーバーライドし、
// 解決失敗 (null) のフォールバック挙動を検証することもできる。
// 絶対パス解決ロジック自体は `resolveExecutablePath.test.ts` で別途検証する。
const mockResolveSpawnCommand = vi.fn();
const mockResolveNativeExecutableOnPath = vi.fn();
const mockResolveWindowsSystemExecutable = vi.fn();
vi.mock("../commands/resolveExecutablePath", () => ({
	resolveNativeExecutableOnPath: (...args: unknown[]) =>
		mockResolveNativeExecutableOnPath(...args),
	resolveSpawnCommand: (...args: unknown[]) => mockResolveSpawnCommand(...args),
	resolveWindowsSystemExecutable: (...args: unknown[]) =>
		mockResolveWindowsSystemExecutable(...args),
}));

const mockShowErrorMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockExecuteCommand = vi.fn();
const mockOpenExternal = vi.fn();
const mockParseUri = vi.fn((url: string) => url);

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: (...args: unknown[]) => mockShowErrorMessage(...args),
		showWarningMessage: vi.fn(),
		showQuickPick: vi.fn(),
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
			get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
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

describe("runGitSc", () => {
	let runGitSc: typeof import("../commands/runGitSc").runGitSc;
	let mockOutputChannel: {
		show: ReturnType<typeof vi.fn>;
		appendLine: ReturnType<typeof vi.fn>;
		append: ReturnType<typeof vi.fn>;
		dispose: ReturnType<typeof vi.fn>;
	};

	beforeEach(async () => {
		vi.clearAllMocks();
		mockGetGitWorkspaceRoot.mockReturnValue("/test/workspace");
		mockResolveNativeExecutableOnPath.mockReturnValue(null);
		mockResolveWindowsSystemExecutable.mockReturnValue(TASKKILL_COMMAND);
		// resolveSpawnCommand の既定挙動をこのテスト専用の固定値に戻す。
		// 引数 args をそのままパススルーすることで spawn 検証用 expect を簡潔に保つ。
		mockResolveSpawnCommand.mockImplementation(
			(name: string, args: readonly string[] = []) => ({
				command: name,
				args: [...args],
				windowsVerbatimArguments: false,
			}),
		);
		mockOutputChannel = {
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		};
		// withProgress のコールバックを即時実行する
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
		const mod = await import("../commands/runGitSc");
		runGitSc = mod.runGitSc;
	});

	it("should show error when no workspace folder is open", async () => {
		const vscode = await import("vscode");
		const original = vscode.workspace.workspaceFolders;
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: undefined,
			writable: true,
			configurable: true,
		});

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No workspace folder open",
		);

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: original,
			writable: true,
			configurable: true,
		});
	});

	it("should show error when no Git repository is found in open workspace", async () => {
		mockGetGitWorkspaceRoot.mockReturnValue(null);

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No Git repository found in open workspace",
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("should spawn git-sc with -a flag when stageAll is true", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			stageAll: true,
			autoConfirm: true,
		});

		// 正常終了を疑似的に発火
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-a", "-y"],
			expect.objectContaining({
				cwd: "/test/workspace",
				shell: false,
			}),
		);
	});

	it("should use the resolved Git workspace root", async () => {
		mockGetGitWorkspaceRoot.mockReturnValue("/test/repo");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-y"],
			expect.objectContaining({
				cwd: "/test/repo",
				shell: false,
			}),
		);
	});

	it("should spawn git-sc with -b flag when includeBody is true", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			includeBody: true,
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-b", "-y"],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should spawn git-sc with all flags when all options are true", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			stageAll: true,
			includeBody: true,
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-a", "-b", "-y"],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should show success message on exit code 0", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockShowInformationMessage).toHaveBeenCalledWith(
			"Git Smart Commit completed!",
		);
		expect(mockExecuteCommand).toHaveBeenCalledWith("git.refresh");
	});

	it("should show error message on non-zero exit code", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("some error"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("some error");
		expect(mockShowErrorMessage).toHaveBeenCalled();
	});

	it("should show installation link on exit code 127 with command-not-found stderr", async () => {
		// 本拡張は POSIX で `shell: false` 起動するため、
		// 起動済み git-sc が exit 127 を返した場合は単独で「未検出」と判定しない。
		// shell 経由起動時など stderr に未検出メッセージが乗っているケースのみ案内を出す。
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
	});

	it("should open installation page when user selects installation link", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockParseUri).toHaveBeenCalledWith(
			"https://github.com/owayo/git-smart-commit#installation",
		);
		expect(mockOpenExternal).toHaveBeenCalledWith(
			"https://github.com/owayo/git-smart-commit#installation",
		);
	});

	it("should log a warning when opening installation page fails", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");
		mockOpenExternal.mockRejectedValueOnce(new Error("open failed"));

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		await new Promise((resolve) => setImmediate(resolve));

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"\n⚠️ Failed to open installation guide: open failed",
		);
	});

	it("インストール案内の reject 値が Error でなくても文字列化して警告を記録する", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");
		// Thenable は任意の値で reject し得る。catch 内の String(error) 分岐が退行して
		// "[object Object]" 警告にならないよう回帰固定する。
		mockOpenExternal.mockRejectedValueOnce("open rejected with string");

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		await new Promise((resolve) => setImmediate(resolve));

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"\n⚠️ Failed to open installation guide: open rejected with string",
		);
	});

	it("should log a warning when openExternal resolves false", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");
		// openExternal は Thenable<boolean> を返し、false 解決は「オープンに失敗」を意味する。
		// reject だけでなく false の握りつぶしも防ぐことを検証する。
		mockOpenExternal.mockResolvedValueOnce(false);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		await new Promise((resolve) => setImmediate(resolve));

		expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
			"\n⚠️ Failed to open installation guide: VS Code returned false",
		);
	});

	it("should not log a warning when openExternal resolves true", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");
		// 正常にオープンできた場合 (true 解決) は警告を出さない。
		// opened === false で判定しているため、true/undefined を失敗扱いしない。
		mockOpenExternal.mockResolvedValueOnce(true);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		await new Promise((resolve) => setImmediate(resolve));

		const appendLineCalls = (
			mockOutputChannel.appendLine as ReturnType<typeof vi.fn>
		).mock.calls.map((c) => c[0] as string);
		expect(
			appendLineCalls.some((line) =>
				line.includes("Failed to open installation guide"),
			),
		).toBe(false);
	});

	it("should show installation link on Windows command-not-found message", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

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

	it("should handle process spawn error (ENOENT)", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue(undefined);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

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

	it("should not show duplicate UI when close fires after spawn error (ENOENT)", async () => {
		// POSIX で spawn("git-sc", ...) が ENOENT になった場合、
		// Node.js は error → close (code=null) の順でイベントを発火する。
		// 現在の実装は settled フラグで保護しているため、
		// UI 通知と outputChannel 出力の二重化が起きないことを確認する。
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue(undefined);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.__emit("error", new Error("spawn git-sc ENOENT"));
			proc.__emit("close", null);
		}, 10);

		await expect(promise).rejects.toThrow("ENOENT");

		// インストール案内ダイアログは 1 回だけ
		expect(mockShowErrorMessage).toHaveBeenCalledTimes(1);
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
		// outputChannel には close 経由の "❌ git-sc failed with code ..." が出力されない
		const appendLineCalls = (
			mockOutputChannel.appendLine as ReturnType<typeof vi.fn>
		).mock.calls.map((c) => c[0] as string);
		expect(
			appendLineCalls.some((line) => line.includes("git-sc failed with code")),
		).toBe(false);
	});

	it("should ignore a late error event fired after successful close", async () => {
		// close(0) で settled になった後に、まれに error イベントが遅れて発火するケース。
		// error ハンドラは settled ガードで早期 return し、成功通知の後に失敗通知や
		// "Failed to start git-sc" ログを二重に出さないことを確認する。
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.__emit("close", 0);
			proc.__emit("error", new Error("late error after close"));
		}, 10);

		await promise;

		// 成功通知は 1 回だけ、失敗通知は出ない
		expect(mockShowInformationMessage).toHaveBeenCalledTimes(1);
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
		// error 経由の "Failed to start git-sc" ログも出力されない
		const lateErrorCalls = (
			mockOutputChannel.appendLine as ReturnType<typeof vi.fn>
		).mock.calls.map((c) => c[0] as string);
		expect(
			lateErrorCalls.some((line) => line.includes("Failed to start git-sc")),
		).toBe(false);
	});

	it("should capture stdout output", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stdout?.emit("data", Buffer.from("output line"));
			proc.__emit("close", 0);
		}, 10);

		await promise;

		expect(mockOutputChannel.append).toHaveBeenCalledWith("output line");
	});

	it("should spawn with no flags when no options provided", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never);

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			[],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should use workspace config flags when options are omitted", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		const vscode = await import("vscode");

		vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
			get: vi.fn((key: string, defaultValue: unknown) => {
				if (key === "includeBody" || key === "autoConfirm") {
					return true;
				}
				return defaultValue;
			}),
		} as never);

		const promise = runGitSc(mockOutputChannel as never);

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-b", "-y"],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should prioritize explicit options over workspace config", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		const vscode = await import("vscode");

		vi.mocked(vscode.workspace.getConfiguration).mockReturnValueOnce({
			get: vi.fn(() => true),
		} as never);

		const promise = runGitSc(mockOutputChannel as never, {
			includeBody: false,
			autoConfirm: false,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			[],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should handle non-ENOENT spawn error", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("error", new Error("spawn EACCES")), 10);

		await expect(promise).rejects.toThrow("EACCES");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to run git-sc: spawn EACCES",
		);
	});

	it("should set FORCE_COLOR=0 in process env", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

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

	it("should fallback to exit code message when stderr and stdout are empty", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 42), 10);

		await expect(promise).rejects.toThrow("Process exited with code 42");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git Smart Commit failed: Process exited with code 42",
		);
	});

	it("should use stdout as error message when stderr is empty on failure", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stdout?.emit("data", Buffer.from("stdout error detail"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("stdout error detail");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git Smart Commit failed: stdout error detail",
		);
	});

	it("should capture stderr output", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("warning message"));
			proc.__emit("close", 0);
		}, 10);

		await promise;

		expect(mockOutputChannel.append).toHaveBeenCalledWith("warning message");
	});

	it("should resolve safely when error fires after cancellation", async () => {
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
			runGitSc(mockOutputChannel as never, { autoConfirm: true }),
		).resolves.toBeUndefined();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should show error when workspace folders is empty array", async () => {
		const vscode = await import("vscode");
		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: [],
			writable: true,
			configurable: true,
		});

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"No workspace folder open",
		);

		Object.defineProperty(vscode.workspace, "workspaceFolders", {
			value: [{ uri: { fsPath: "/test/workspace" } }],
			writable: true,
			configurable: true,
		});
	});

	it("should resolve safely when close fires after cancellation", async () => {
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
			runGitSc(mockOutputChannel as never, { autoConfirm: true }),
		).resolves.toBeUndefined();
		expect(proc.kill).toHaveBeenCalled();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should not show error when cancelled", async () => {
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
			runGitSc(mockOutputChannel as never, { autoConfirm: true }),
		).resolves.toBeUndefined();
		expect(proc.kill).toHaveBeenCalled();
		expect(mockShowErrorMessage).not.toHaveBeenCalled();
	});

	it("should ignore cancellation after process has already settled", async () => {
		// `close` で settled になった後に、VS Code 側からキャンセル通知が遅れて到着するレース。
		// settled 後の cancel ハンドラは終了処理を再実行せず、誤った "cancelled" ログも出さない。
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
				// 先に正常終了 (close 0) → settled = true
				setTimeout(() => proc.__emit("close", 0), 10);
				await progressPromise;
				// settled 後にキャンセルが遅れて到着するレース
				cancelHandler?.();
			},
		);

		await runGitSc(mockOutputChannel as never, { autoConfirm: true });

		// settled 済みなのでプロセスへ kill / taskkill は送られない
		expect(proc.kill).not.toHaveBeenCalled();
		expect(mockSpawn).not.toHaveBeenCalledWith(
			TASKKILL_COMMAND,
			expect.any(Array),
			expect.any(Object),
		);
		// 「cancelled by user」のログも出力されない
		expect(mockOutputChannel.appendLine).not.toHaveBeenCalledWith(
			"\n⚠️ git-sc cancelled by user",
		);
	});

	it("should not include -a flag when stageAll is false", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			stageAll: false,
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-y"],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should not include -b flag when includeBody is false", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			includeBody: false,
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-y"],
			expect.objectContaining({ shell: false }),
		);
	});

	it("should accumulate chunked stdout data on success", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stdout?.emit("data", Buffer.from("chunk1"));
			proc.stdout?.emit("data", Buffer.from("chunk2"));
			proc.__emit("close", 0);
		}, 10);

		await promise;

		expect(mockOutputChannel.append).toHaveBeenCalledWith("chunk1");
		expect(mockOutputChannel.append).toHaveBeenCalledWith("chunk2");
	});

	it("should accumulate chunked stderr data on failure", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("err1"));
			proc.stderr?.emit("data", Buffer.from("err2"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("err1err2");
	});

	it("should show git-not-found error when getGitWorkspaceRoot throws ENOENT", async () => {
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw new Error("spawn git ENOENT");
		});

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git command not found. Please install Git and ensure it's in your PATH.",
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("should not open external URL when user dismisses installation dialog", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		// ユーザーがダイアログを閉じた場合（undefined が返る）
		mockShowErrorMessage.mockResolvedValue(undefined);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("zsh: command not found: git-sc"));
			proc.__emit("close", 127);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);
		expect(mockOpenExternal).not.toHaveBeenCalled();
	});

	it("should report progress message when spawning git-sc", async () => {
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

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockProgressReport).toHaveBeenCalledWith({
			message: "Generating commit message...",
		});
	});

	it("should not include -a flag when stageAll is undefined", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			includeBody: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		// stageAll 未指定時は -a フラグが含まれない
		const args = mockSpawn.mock.calls[0][1] as string[];
		expect(args).not.toContain("-a");
		expect(args).toContain("-b");
	});

	it("should truncate long error message to 100 characters", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		const longError = "x".repeat(200);
		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from(longError));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();
		// エラーメッセージが 100 文字で切り詰められていることを検証
		const errorArg = mockShowErrorMessage.mock.calls[0][0] as string;
		expect(errorArg).toBe(`Git Smart Commit failed: ${"x".repeat(100)}`);
	});

	it("should show generic error when getGitWorkspaceRoot throws non-ENOENT error", async () => {
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw new Error(
				"fatal: unsafe repository ('/repo' is owned by someone else)",
			);
		});

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to detect Git repository: fatal: unsafe repository ('/repo' is owned by someone else)",
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("getGitWorkspaceRoot が非 Error 値を throw しても文字列化してエラー表示する", async () => {
		// JS は任意の値を throw できる。`error instanceof Error ? ... : String(error)` の
		// String(error) 分岐が退行すると "[object Object]" 表示やクラッシュになるため回帰固定する。
		mockGetGitWorkspaceRoot.mockImplementation(() => {
			throw "fatal: not an Error instance";
		});

		await runGitSc(mockOutputChannel as never);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Failed to detect Git repository: fatal: not an Error instance",
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("should call outputChannel.show with preserveFocus=true before spawning", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockOutputChannel.show).toHaveBeenCalledWith(true);
	});

	it("should write header lines to outputChannel before spawning", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			stageAll: true,
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		// ヘッダー区切り線、実行コマンド、作業ディレクトリの出力を検証
		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("=".repeat(50)))).toBe(true);
		expect(calls.some((c) => c.includes("Running: git-sc -a -y"))).toBe(true);
		expect(
			calls.some((c) => c.includes("Working directory: /test/workspace")),
		).toBe(true);
	});

	it("should write success marker to outputChannel on exit code 0", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("✅ git-sc completed successfully")),
		).toBe(true);
	});

	it("should write failure marker to outputChannel on non-zero exit", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("error"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("❌ git-sc failed with code 1"))).toBe(
			true,
		);
	});

	it("should write cancellation marker to outputChannel when cancelled", async () => {
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

		await runGitSc(mockOutputChannel as never, { autoConfirm: true });

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(calls.some((c) => c.includes("⚠️ git-sc cancelled by user"))).toBe(
			true,
		);
	});

	it("should call withProgress with correct options", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

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

	it("should not call git.refresh on failure", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			proc.stderr?.emit("data", Buffer.from("error"));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow();
		expect(mockExecuteCommand).not.toHaveBeenCalledWith("git.refresh");
	});

	it("should preserve multibyte stdout split across stream chunks", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			// "あ" (E3 81 82) を意図的に分割し、UTF-8 境界をまたぐ出力を再現する。
			proc.stdout?.push(Buffer.from([0xe3, 0x81]));
			proc.stdout?.push(Buffer.from([0x82]));
			proc.__emit("close", 0);
		}, 10);
		await promise;

		const appended = mockOutputChannel.append.mock.calls
			.map((c: unknown[]) => c[0])
			.join("");
		expect(appended).toContain("あ");
		expect(appended).not.toContain("�");
	});

	it("should preserve multibyte stderr split across stream chunks", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => {
			// エラー出力側でも同じ UTF-8 境界分割を再現する。
			proc.stderr?.push(Buffer.from([0xe3, 0x81]));
			proc.stderr?.push(Buffer.from([0x82]));
			proc.__emit("close", 1);
		}, 10);

		await expect(promise).rejects.toThrow("あ");
		const appended = mockOutputChannel.append.mock.calls
			.map((c: unknown[]) => c[0])
			.join("");
		expect(appended).toContain("あ");
		expect(appended).not.toContain("�");
	});

	it("should write spawn error marker to outputChannel", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("error", new Error("spawn EACCES")), 10);

		await expect(promise).rejects.toThrow();

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("❌ Failed to start git-sc: spawn EACCES")),
		).toBe(true);
	});

	it("should treat null exit code as failure when not cancelled", async () => {
		// プロセスがシグナルで終了し code が null になるケース（キャンセル以外）
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", null), 10);

		await expect(promise).rejects.toThrow("Process exited with code null");
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"Git Smart Commit failed: Process exited with code null",
		);
	});

	it("should include working directory in header output", async () => {
		mockGetGitWorkspaceRoot.mockReturnValue("/custom/path/repo");
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("Working directory: /custom/path/repo")),
		).toBe(true);
	});

	it("should send SIGTERM (not default) on cancellation to ensure child kill", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		let cancelHandler: (() => void) | undefined;
		const progress = { report: vi.fn() };
		const token = {
			onCancellationRequested: vi.fn((cb: () => void) => {
				cancelHandler = cb;
			}),
		};
		mockWithProgress.mockImplementationOnce((_options, callback) =>
			callback(progress, token),
		);

		const progressPromise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		cancelHandler?.();
		setTimeout(() => proc.__emit("close", null), 5);
		await progressPromise;

		expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
	});

	it("should escalate to SIGKILL on POSIX when close does not arrive after SIGTERM", async () => {
		// SIGTERM を無視するプロセスがあると close が来ず Promise が永久 pending になるため、
		// POSIX では 5 秒経過後に SIGKILL に昇格してプロセスグループを強制終了する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		// signal 0 (グループ存在確認) には ESRCH を投げ、SIGKILL 後にグループが
		// 消滅済みであることをシミュレートする (close 時の消滅確認で即 resolve させる)。
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 12345, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();

			// 直後は SIGTERM のみ
			expect(killSpy).toHaveBeenCalledWith(-12345, "SIGTERM");
			expect(killSpy).not.toHaveBeenCalledWith(-12345, "SIGKILL");

			// 5 秒経過で SIGKILL に昇格
			await vi.advanceTimersByTimeAsync(5000);
			expect(killSpy).toHaveBeenCalledWith(-12345, "SIGKILL");

			// close 発火で Promise が解決される
			proc.__emit("close", null);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should not escalate to SIGKILL when close arrives quickly after cancellation", async () => {
		// 通常のキャンセルフロー: SIGTERM 後すぐ close が来てプロセスグループも消滅済みの
		// 場合は SIGKILL を送らない。forceKillTimer が close 時にクリアされることを保証する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		// signal 0 (グループ存在確認) には ESRCH を投げ、SIGTERM でグループ全体が
		// 素直に終了したことをシミュレートする。
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 22222, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			proc.__emit("close", null);

			// close 後に 5 秒経過しても SIGKILL は送られない (timer がクリアされている)
			await vi.advanceTimersByTimeAsync(10_000);
			expect(killSpy).not.toHaveBeenCalledWith(-22222, "SIGKILL");

			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("キャンセル後の close 時にプロセスグループが残存していれば SIGKILL 昇格まで resolve を遅延する", async () => {
		// POSIX の close は「直接の子と stdio の終了」しか保証せず、stdio を継承しない
		// 孫プロセスが SIGTERM を無視して生き残るケースがある。close で即 resolve すると
		// forceKillTimer がクリアされ SIGKILL 昇格が走らず孫が孤児として残るため、
		// グループ消滅を signal 0 ポーリングで確認してから resolve する回帰テスト。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		// SIGKILL が送られるまでグループは存続し、SIGKILL 後の signal 0 で ESRCH を返す
		let groupAlive = true;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0 && !groupAlive) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			if (signal === "SIGKILL") {
				groupAlive = false;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 33333, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			expect(killSpy).toHaveBeenCalledWith(-33333, "SIGTERM");

			// 直接の子は close するが、孫プロセスがグループに残存している
			proc.__emit("close", null);
			let resolved = false;
			void progressPromise.then(() => {
				resolved = true;
			});

			// グループ残存中は resolve されず、SIGKILL もまだ送られない
			await vi.advanceTimersByTimeAsync(1000);
			expect(resolved).toBe(false);
			expect(killSpy).not.toHaveBeenCalledWith(-33333, "SIGKILL");

			// キャンセルから 5 秒経過で SIGKILL 昇格 → グループ消滅 → resolve
			await vi.advanceTimersByTimeAsync(4000);
			expect(killSpy).toHaveBeenCalledWith(-33333, "SIGKILL");
			await vi.advanceTimersByTimeAsync(100);
			expect(resolved).toBe(true);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("キャンセル後の error 経路でもプロセスグループの消滅確認まで resolve を遅延する", async () => {
		// キャンセル後に kill 失敗等で error イベントが発火するケース。close と同様に
		// 即 resolve すると forceKillTimer がクリアされ SIGKILL 昇格が走らないため、
		// error 経路もグループ消滅の確認へ合流することを固定する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		let groupAlive = true;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0 && !groupAlive) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			if (signal === "SIGKILL") {
				groupAlive = false;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 66666, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();

			// close ではなく error が発火 (グループは残存)
			proc.__emit("error", new Error("kill EPERM"));
			let resolved = false;
			void progressPromise.then(() => {
				resolved = true;
			});

			await vi.advanceTimersByTimeAsync(1000);
			expect(resolved).toBe(false);

			// キャンセルから 5 秒経過で SIGKILL 昇格 → グループ消滅 → resolve
			await vi.advanceTimersByTimeAsync(4000);
			expect(killSpy).toHaveBeenCalledWith(-66666, "SIGKILL");
			await vi.advanceTimersByTimeAsync(100);
			expect(resolved).toBe(true);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("キャンセル後に error と close が連続しても消滅待ちを二重開始しない", async () => {
		// ChildProcess は error の後に close も発火し得る。両ハンドラから同じ
		// ポーリングを開始すると signal 0 の確認と待機時間加算が二重化するため、
		// terminal event が連続しても開始は 1 回だけに固定する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		let groupAlive = true;
		let existenceChecks = 0;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) {
				existenceChecks += 1;
				if (!groupAlive) {
					const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
					error.code = "ESRCH";
					throw error;
				}
			}
			if (signal === "SIGKILL") {
				groupAlive = false;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 66767, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			proc.__emit("error", new Error("kill EPERM"));
			expect(existenceChecks).toBe(1);
			proc.__emit("close", null);
			expect(existenceChecks).toBe(1);

			await vi.advanceTimersByTimeAsync(5000);
			expect(killSpy).toHaveBeenCalledWith(-66767, "SIGKILL");
			await vi.advanceTimersByTimeAsync(100);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("プロセスグループ確認が非 Error 値を投げても待機を継続する", async () => {
		// process.kill は通常 ErrnoException を投げるが、実行環境やテスト差し替えが
		// 非 Error 値を投げても catch 内の code 参照で再 throw してはならない。
		// ESRCH と安全に確認できない値はグループ存続扱いにして SIGKILL 昇格を待つ。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		let groupAlive = true;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) {
				if (groupAlive) {
					throw null;
				}
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			if (signal === "SIGKILL") {
				groupAlive = false;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 67676, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			proc.__emit("close", null);

			let resolved = false;
			void progressPromise.then(() => {
				resolved = true;
			});
			await vi.advanceTimersByTimeAsync(1000);
			expect(resolved).toBe(false);

			await vi.advanceTimersByTimeAsync(4000);
			expect(killSpy).toHaveBeenCalledWith(-67676, "SIGKILL");
			await vi.advanceTimersByTimeAsync(100);
			expect(resolved).toBe(true);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("グループ消滅待ちポーリング中に deactivate されたら残存グループへ即 SIGKILL を送る", async () => {
		// close ハンドラ冒頭で active map から削除済みのままだと、ポーリング中の
		// reload / deactivate で残存グループへ何も送れず孫プロセスが孤児化する。
		// ポーリング開始時に「残存グループを即 SIGKILL する」shutdown ハンドラを
		// map へ再登録することを固定する。
		const { terminateActiveGitScProcesses } = await import(
			"../commands/spawnGitScProcess"
		);
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		let groupAlive = true;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0 && !groupAlive) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			if (signal === "SIGKILL") {
				groupAlive = false;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 77777, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			proc.__emit("close", null);

			// ポーリング開始直後 (SIGKILL 昇格前) に deactivate 相当が走る
			await vi.advanceTimersByTimeAsync(200);
			expect(killSpy).not.toHaveBeenCalledWith(-77777, "SIGKILL");
			terminateActiveGitScProcesses(mockOutputChannel as never);

			// shutdown ハンドラが残存グループへ即 SIGKILL を送り、次のポーリングで resolve する
			expect(killSpy).toHaveBeenCalledWith(-77777, "SIGKILL");
			await vi.advanceTimersByTimeAsync(100);
			await progressPromise;
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("SIGKILL 後もプロセスグループが消えない場合は上限時間で警告して resolve する", async () => {
		// uninterruptible sleep 等で SIGKILL すら効かない異常系。ポーリングを無期限に
		// 続けると進捗表示が永久に残るため、上限時間超過で警告を出して resolve する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		// signal 0 が常に成功 = グループが永遠に残存し続ける
		const killSpy = vi.fn(() => true);
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;
		vi.useFakeTimers();

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 44444, configurable: true });
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			await vi.advanceTimersByTimeAsync(10);
			cancelHandler?.();
			proc.__emit("close", null);

			let resolved = false;
			void progressPromise.then(() => {
				resolved = true;
			});

			// 上限 (10 秒) までは resolve されない
			await vi.advanceTimersByTimeAsync(9000);
			expect(resolved).toBe(false);

			// 上限超過で警告を出して resolve する
			await vi.advanceTimersByTimeAsync(2000);
			expect(resolved).toBe(true);
			await progressPromise;

			const calls = mockOutputChannel.appendLine.mock.calls.map(
				(c: unknown[]) => c[0],
			) as string[];
			expect(
				calls.some((c) =>
					c.includes(
						"git-sc process group is still alive after cancellation; giving up waiting",
					),
				),
			).toBe(true);
		} finally {
			vi.useRealTimers();
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should wait for close event before resolving cancelled run", async () => {
		// キャンセル直後に resolveOnce を呼ばず、プロセスの close を待ってから
		// resolve することで、VS Code 上で「終了未確定なのに成功通知」になる事象を防ぐ。
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		let cancelHandler: (() => void) | undefined;
		const progress = { report: vi.fn() };
		const token = {
			onCancellationRequested: vi.fn((cb: () => void) => {
				cancelHandler = cb;
			}),
		};
		mockWithProgress.mockImplementationOnce((_options, callback) =>
			callback(progress, token),
		);

		const progressPromise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		await new Promise((resolve) => setTimeout(resolve, 10));
		cancelHandler?.();

		// close を発火しなければ progressPromise は未解決のまま
		let resolved = false;
		progressPromise.then(() => {
			resolved = true;
		});

		await new Promise((resolve) => setTimeout(resolve, 30));
		expect(resolved).toBe(false);

		// close 発火後に解決される
		proc.__emit("close", null);
		await progressPromise;
		expect(resolved).toBe(true);
	});

	it("should spawn git-sc with shell:false + windowsVerbatimArguments from resolveSpawnCommand on win32", async () => {
		// 新実装では .cmd/.bat の場合のみ cmd.exe 経由で起動する。
		// mockResolveSpawnCommand が cmd.exe 経由相当の解決結果を返した場合、
		// spawn は windowsVerbatimArguments:true、shell:false で呼ばれることを検証する。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});

		try {
			mockResolveSpawnCommand.mockReturnValueOnce({
				command: "C:\\Windows\\System32\\cmd.exe",
				args: ["/d", "/s", "/c", '""C:\\bin\\git-sc.CMD" "-y""'],
				windowsVerbatimArguments: true,
			});

			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const promise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			setTimeout(() => proc.__emit("close", 0), 10);
			await promise;

			expect(mockSpawn).toHaveBeenCalledWith(
				"C:\\Windows\\System32\\cmd.exe",
				["/d", "/s", "/c", '""C:\\bin\\git-sc.CMD" "-y""'],
				expect.objectContaining({
					shell: false,
					windowsVerbatimArguments: true,
					windowsHide: true,
					detached: false,
				}),
			);
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should spawn git-sc with shell:false + detached:true on POSIX to enable process-group kill", async () => {
		// POSIX では detached:true でプロセスグループを作り、キャンセル時に
		// git-sc の子孫プロセス (git 等) ごと終了させる。
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "darwin",
			configurable: true,
		});

		try {
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			const promise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			setTimeout(() => proc.__emit("close", 0), 10);
			await promise;

			expect(mockSpawn).toHaveBeenCalledWith(
				"git-sc",
				["-y"],
				expect.objectContaining({
					shell: false,
					detached: true,
					windowsVerbatimArguments: false,
					windowsHide: true,
				}),
			);
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should call taskkill /T /F on win32 cancellation", async () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 4242, configurable: true });
			mockSpawn.mockReturnValueOnce(proc); // git-sc 起動分
			mockSpawn.mockReturnValueOnce(createMockProcess()); // taskkill 起動分

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			await new Promise((resolve) => setTimeout(resolve, 10));
			cancelHandler?.();
			setTimeout(() => proc.__emit("close", null), 5);
			await progressPromise;

			expect(mockSpawn).toHaveBeenCalledWith(
				TASKKILL_COMMAND,
				["/PID", "4242", "/T", "/F"],
				expect.objectContaining({ stdio: "ignore", windowsHide: true }),
			);
			// Windows ルートでは process.kill は呼ばれない
			expect(proc.kill).not.toHaveBeenCalled();
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("Windows のキャンセル後に error が発火しても失敗通知せず解決する", async () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});

		try {
			const proc = createMockProcess();
			mockSpawn.mockReturnValue(proc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			cancelHandler?.();
			proc.__emit("error", new Error("terminated during cancellation"));
			await progressPromise;

			expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
			expect(mockShowErrorMessage).not.toHaveBeenCalled();
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should log taskkill spawn errors on win32 cancellation", async () => {
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "win32",
			configurable: true,
		});

		try {
			const proc = createMockProcess();
			const taskkillProc = createMockProcess();
			Object.defineProperty(proc, "pid", { value: 4242, configurable: true });
			mockSpawn.mockReturnValueOnce(proc);
			mockSpawn.mockReturnValueOnce(taskkillProc);

			let cancelHandler: (() => void) | undefined;
			const progress = { report: vi.fn() };
			const token = {
				onCancellationRequested: vi.fn((cb: () => void) => {
					cancelHandler = cb;
				}),
			};
			mockWithProgress.mockImplementationOnce((_options, callback) =>
				callback(progress, token),
			);

			const progressPromise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			await new Promise((resolve) => setTimeout(resolve, 10));
			cancelHandler?.();
			taskkillProc.__emit("error", new Error("spawn taskkill ENOENT"));
			setTimeout(() => proc.__emit("close", null), 5);
			await progressPromise;

			expect(mockOutputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ Failed to start taskkill: spawn taskkill ENOENT",
			);
			expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should abort and show installation dialog when resolveSpawnCommand returns null", async () => {
		// Windows で PATH 上に git-sc が見つからない場合、unsafe な spawn 起動 (cwd ハイジャック)
		// を回避するためインストール案内へ早期に抜けることを検証する
		mockResolveSpawnCommand.mockReturnValueOnce(null);
		mockShowErrorMessage.mockResolvedValue(undefined);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		await expect(promise).rejects.toThrow("git-sc command not found in PATH");
		expect(mockSpawn).not.toHaveBeenCalled();
		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		);

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) =>
				c.includes("git-sc not found in PATH. Aborting before unsafe spawn."),
			),
		).toBe(true);
	});

	it("should log Git refresh failure to outputChannel without rejecting the run", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		// git.refresh が reject するシナリオ（Git 拡張が無効化された等）
		mockExecuteCommand.mockImplementationOnce(() =>
			Promise.reject(new Error("git.refresh disabled")),
		);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		// run 自体は成功扱いになり、outputChannel に警告が記録される
		expect(mockShowInformationMessage).toHaveBeenCalledWith(
			"Git Smart Commit completed!",
		);
		// catch は async なので次マイクロタスクで実行される
		await new Promise((resolve) => setImmediate(resolve));

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) => c.includes("Git refresh failed: git.refresh disabled")),
		).toBe(true);
	});

	it("git.refresh が非 Error 値で reject しても文字列化して警告を記録する", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		// Thenable は任意の値で reject し得る。catch 内の String(error) 分岐が退行して
		// "[object Object]" 警告にならないよう回帰固定する。
		mockExecuteCommand.mockImplementationOnce(() =>
			Promise.reject("refresh rejected with string"),
		);

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		// catch は async なので次マイクロタスクで実行される
		await new Promise((resolve) => setImmediate(resolve));

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) =>
				c.includes("Git refresh failed: refresh rejected with string"),
			),
		).toBe(true);
	});

	it("terminateActiveGitScProcesses はアクティブなプロセスが無ければ何も出力しない", async () => {
		// 通常の deactivate (git-sc 実行中でない) で走る経路。プロセス 0 件のときは
		// "Terminating ... on shutdown" の警告ログを出さず、静かに終了する。
		const { terminateActiveGitScProcesses } = await import(
			"../commands/spawnGitScProcess"
		);

		terminateActiveGitScProcesses(mockOutputChannel as never);

		expect(mockOutputChannel.appendLine).not.toHaveBeenCalled();
	});

	it("terminateActiveGitScProcesses は実行中プロセスを即時強制終了し、その close は成功通知を出さない", async () => {
		const { terminateActiveGitScProcesses } = await import(
			"../commands/spawnGitScProcess"
		);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		// spawn は withProgress コールバック内で同期的に行われ、active map に登録される
		const promise = runGitSc(mockOutputChannel as never, { autoConfirm: true });

		// deactivate 相当: 実行中プロセスを一括終了する
		terminateActiveGitScProcesses(mockOutputChannel as never);
		// POSIX (テストホスト) では pid 未定義のためプロセスグループ kill が
		// child.kill("SIGKILL") にフォールバックする。拡張ホスト終了後は
		// 昇格タイマーを実行できないため、通常の deactivate でも即時強制終了する。
		expect(proc.kill).toHaveBeenCalledWith("SIGKILL");

		// shutdown ハンドラが isCancelled を立てるため、kill 後の close(0) は
		// キャンセル扱いとなり、誤った成功通知・git.refresh を出さずに resolve する
		proc.__emit("close", 0);
		await promise;
		expect(mockShowInformationMessage).not.toHaveBeenCalled();
		expect(mockExecuteCommand).not.toHaveBeenCalledWith("git.refresh");
	});

	it("通常の deactivate は POSIX プロセスグループへ即 SIGKILL を送る", async () => {
		const { terminateActiveGitScProcesses } = await import(
			"../commands/spawnGitScProcess"
		);
		const originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		Object.defineProperty(globalThis.process, "platform", {
			value: "linux",
			configurable: true,
		});
		const originalKill = globalThis.process.kill;
		const killSpy = vi.fn((_pid: number, signal?: string | number) => {
			if (signal === 0) {
				const error = new Error("kill ESRCH") as NodeJS.ErrnoException;
				error.code = "ESRCH";
				throw error;
			}
			return true;
		});
		globalThis.process.kill = killSpy as typeof globalThis.process.kill;

		try {
			const proc = createMockProcess();
			Object.defineProperty(proc, "pid", {
				value: 54321,
				configurable: true,
			});
			mockSpawn.mockReturnValue(proc);

			const promise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});

			terminateActiveGitScProcesses(mockOutputChannel as never);

			// 拡張ホスト終了後は昇格タイマーを実行できないため、
			// 猶予付きの SIGTERM を挟まずプロセスグループを即時強制終了する。
			expect(killSpy).toHaveBeenCalledWith(-54321, "SIGKILL");

			proc.__emit("close", 0);
			await promise;
		} finally {
			globalThis.process.kill = originalKill;
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("キャンセル後の close 前に deactivate が来たら強制終了へ昇格する", async () => {
		// ユーザーキャンセル (isCancelled=true、close 未達で active map に残存) の直後に
		// deactivate 相当の terminateActiveGitScProcesses が走るレース。SIGTERM を無視する
		// プロセスでも拡張ホスト終了後に孤児化しないよう、POSIX では SIGKILL へ昇格する。
		const { terminateActiveGitScProcesses } = await import(
			"../commands/spawnGitScProcess"
		);
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		let cancelHandler: (() => void) | undefined;
		mockWithProgress.mockImplementationOnce(
			async (
				_options: unknown,
				callback: (progress: unknown, token: unknown) => Promise<void>,
			) => {
				const progress = { report: vi.fn() };
				const token = {
					onCancellationRequested: vi.fn((handler: () => void) => {
						cancelHandler = handler;
					}),
					isCancellationRequested: false,
				};

				const progressPromise = callback(progress, token);
				// ユーザーキャンセル: isCancelled=true、ただし close 未達なので map に残る
				cancelHandler?.();
				// deactivate 相当: close 前でも即時の強制終了へ昇格する
				terminateActiveGitScProcesses(mockOutputChannel as never);
				// close 到達でキャンセル扱いのまま resolve
				setTimeout(() => proc.__emit("close", null), 10);
				return progressPromise;
			},
		);

		await runGitSc(mockOutputChannel as never, { autoConfirm: true });

		expect(proc.kill).toHaveBeenNthCalledWith(1, "SIGTERM");
		expect(proc.kill).toHaveBeenNthCalledWith(2, "SIGKILL");
	});

	it("resolveSpawnCommand が throw した場合は明示的にエラー通知して reject する", async () => {
		// % を含む引数など、安全に起動できない場合は resolveSpawnCommand が throw する。
		// 握り潰さず outputChannel と showErrorMessage で失敗理由を明示する。
		mockResolveSpawnCommand.mockImplementationOnce(() => {
			throw new Error(
				"Argument contains '%' which cmd.exe would expand: \"%USERNAME%\"",
			);
		});

		await expect(
			runGitSc(mockOutputChannel as never, { autoConfirm: true }),
		).rejects.toThrow(/%/);

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining("Cannot safely launch git-sc"),
		);
		expect(mockSpawn).not.toHaveBeenCalled();
	});

	it("resolveSpawnCommand が非 Error 値を throw しても文字列化して通知し Error で reject する", async () => {
		// throw された値が Error でない場合、String(error) で文字列化して通知し、
		// reject には new Error(message) へ包み直して伝搬する分岐の回帰テスト。
		mockResolveSpawnCommand.mockImplementationOnce(() => {
			throw "unsafe argument detected";
		});

		await expect(
			runGitSc(mockOutputChannel as never, { autoConfirm: true }),
		).rejects.toThrow("unsafe argument detected");

		expect(mockShowErrorMessage).toHaveBeenCalledWith(
			expect.stringContaining(
				"Cannot safely launch git-sc: unsafe argument detected",
			),
		);
		expect(mockSpawn).not.toHaveBeenCalled();

		const calls = mockOutputChannel.appendLine.mock.calls.map(
			(c: unknown[]) => c[0],
		) as string[];
		expect(
			calls.some((c) =>
				c.includes("Cannot safely launch git-sc: unsafe argument detected"),
			),
		).toBe(true);
	});
});
