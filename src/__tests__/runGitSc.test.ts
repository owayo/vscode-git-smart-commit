import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
	execSync: vi.fn(),
}));

const mockShowErrorMessage = vi.fn();
const mockShowInformationMessage = vi.fn();
const mockWithProgress = vi.fn();
const mockExecuteCommand = vi.fn();
const mockOpenExternal = vi.fn();

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
	Uri: { parse: vi.fn((url: string) => url) },
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
		mockOutputChannel = {
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		};
		// Make withProgress execute the callback immediately
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

	it("should spawn git-sc with -a flag when stageAll is true", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);

		const promise = runGitSc(mockOutputChannel as never, {
			stageAll: true,
			autoConfirm: true,
		});

		// Simulate successful exit
		setTimeout(() => proc.__emit("close", 0), 10);
		await promise;

		expect(mockSpawn).toHaveBeenCalledWith(
			"git-sc",
			["-a", "-y"],
			expect.objectContaining({
				cwd: "/test/workspace",
				shell: true,
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
			expect.objectContaining({ shell: true }),
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
			expect.objectContaining({ shell: true }),
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

	it("should show installation link on exit code 127 (command not found)", async () => {
		const proc = createMockProcess();
		mockSpawn.mockReturnValue(proc);
		mockShowErrorMessage.mockResolvedValue("View Installation");

		const promise = runGitSc(mockOutputChannel as never, {
			autoConfirm: true,
		});

		setTimeout(() => proc.__emit("close", 127), 10);

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
			expect.objectContaining({ shell: true }),
		);
	});
});
