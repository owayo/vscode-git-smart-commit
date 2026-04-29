import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();
const mockGetGitWorkspaceRoot = vi.fn();

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
	execSync: vi.fn(),
}));

vi.mock("../commands/getGitWorkspaceRoot", () => ({
	getGitWorkspaceRoot: (...args: unknown[]) => mockGetGitWorkspaceRoot(...args),
}));

// Windows シミュレートテストでは PATH 走査の副作用を避けたいので、
// `resolveSpawnCommand` の挙動を旧実装相当 (POSIX→shell:false / win32→shell:true) に固定する。
// テストごとに `mockResolveSpawnCommand.mockReturnValueOnce(null)` 等で個別オーバーライドし、
// 解決失敗 (null) のフォールバック挙動を検証することもできる。
// 絶対パス解決ロジック自体は `resolveExecutablePath.test.ts` で別途検証する。
const mockResolveSpawnCommand = vi.fn();
vi.mock("../commands/resolveExecutablePath", () => ({
	resolveSpawnCommand: (...args: unknown[]) => mockResolveSpawnCommand(...args),
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
		// resolveSpawnCommand の既定挙動を旧実装相当に戻す
		mockResolveSpawnCommand.mockImplementation((name: string) => ({
			command: name,
			useShell: globalThis.process.platform === "win32",
		}));
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

	it("should spawn git-sc with shell:true on win32 platform", async () => {
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

			const promise = runGitSc(mockOutputChannel as never, {
				autoConfirm: true,
			});
			setTimeout(() => proc.__emit("close", 0), 10);
			await promise;

			expect(mockSpawn).toHaveBeenCalledWith(
				"git-sc",
				["-y"],
				expect.objectContaining({ shell: true, windowsHide: true }),
			);
		} finally {
			if (originalPlatform) {
				Object.defineProperty(globalThis.process, "platform", originalPlatform);
			}
		}
	});

	it("should spawn git-sc with shell:false on non-win32 platform", async () => {
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
				expect.objectContaining({ shell: false, windowsHide: true }),
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
				"taskkill",
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
			expect(proc.kill).not.toHaveBeenCalled();
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
});
