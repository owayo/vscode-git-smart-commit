import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();
const TASKKILL_COMMAND = "C:\\Windows\\System32\\taskkill.exe";
const mockResolveNativeExecutableOnPath = vi.fn();
const mockResolveWindowsSystemExecutable = vi.fn();

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
}));

vi.mock("../commands/resolveExecutablePath", () => ({
	resolveNativeExecutableOnPath: (...args: unknown[]) =>
		mockResolveNativeExecutableOnPath(...args),
	resolveWindowsSystemExecutable: (...args: unknown[]) =>
		mockResolveWindowsSystemExecutable(...args),
}));

function createMockProcess(): ChildProcess & {
	__emit: (event: string, ...args: unknown[]) => void;
} {
	const proc = new EventEmitter() as ChildProcess & {
		__emit: (event: string, ...args: unknown[]) => void;
	};
	proc.kill = vi.fn();
	proc.__emit = (event: string, ...args: unknown[]) => {
		proc.emit(event, ...args);
	};
	return proc;
}

describe("terminateProcessForCancellation", () => {
	let terminateProcessForCancellation: typeof import("../commands/terminateProcessForCancellation").terminateProcessForCancellation;
	let outputChannel: { appendLine: ReturnType<typeof vi.fn> };
	let originalPlatform: PropertyDescriptor | undefined;

	beforeEach(async () => {
		vi.clearAllMocks();
		mockResolveWindowsSystemExecutable.mockReturnValue(TASKKILL_COMMAND);
		mockResolveNativeExecutableOnPath.mockReturnValue(null);
		outputChannel = { appendLine: vi.fn() };
		originalPlatform = Object.getOwnPropertyDescriptor(
			globalThis.process,
			"platform",
		);
		const mod = await import("../commands/terminateProcessForCancellation");
		terminateProcessForCancellation = mod.terminateProcessForCancellation;
	});

	function setPlatform(platform: NodeJS.Platform): void {
		Object.defineProperty(globalThis.process, "platform", {
			value: platform,
			configurable: true,
		});
	}

	function restorePlatform(): void {
		if (originalPlatform) {
			Object.defineProperty(globalThis.process, "platform", originalPlatform);
		}
	}

	it("POSIX では子プロセスへ SIGTERM を送る", () => {
		setPlatform("darwin");
		try {
			const child = createMockProcess();

			terminateProcessForCancellation(child, outputChannel as never);

			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
			expect(mockSpawn).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});

	it("SIGTERM 送信が失敗した場合は outputChannel に記録する", () => {
		setPlatform("darwin");
		try {
			const child = createMockProcess();
			vi.mocked(child.kill).mockImplementationOnce(() => {
				throw new Error("kill ESRCH");
			});

			terminateProcessForCancellation(child, outputChannel as never);

			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ Failed to send SIGTERM: kill ESRCH",
			);
		} finally {
			restorePlatform();
		}
	});

	it("Windows では taskkill でプロセスツリーを終了する", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 4242, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);

			expect(mockSpawn).toHaveBeenCalledWith(
				TASKKILL_COMMAND,
				["/PID", "4242", "/T", "/F"],
				{
					windowsHide: true,
					stdio: "ignore",
				},
			);
			expect(child.kill).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});

	it("System32 の taskkill が解決できない場合は安全な PATH 解決結果へフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 4343, configurable: true });
			mockResolveWindowsSystemExecutable.mockReturnValue(null);
			mockResolveNativeExecutableOnPath.mockReturnValue(
				"D:\\Tools\\taskkill.EXE",
			);
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);

			expect(mockSpawn).toHaveBeenCalledWith(
				"D:\\Tools\\taskkill.EXE",
				["/PID", "4343", "/T", "/F"],
				{
					windowsHide: true,
					stdio: "ignore",
				},
			);
			expect(child.kill).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});

	it("taskkill を安全に解決できない場合は bare command を起動せず SIGTERM にフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			Object.defineProperty(child, "pid", { value: 4444, configurable: true });
			mockResolveWindowsSystemExecutable.mockReturnValue(null);
			mockResolveNativeExecutableOnPath.mockReturnValue(null);

			terminateProcessForCancellation(child, outputChannel as never);

			expect(mockSpawn).not.toHaveBeenCalled();
			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ Failed to resolve taskkill executable for cancellation",
			);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("taskkill の非同期起動エラーを記録して SIGTERM にフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 5151, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);
			taskkillProcess.__emit("error", new Error("spawn taskkill ENOENT"));

			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ Failed to start taskkill: spawn taskkill ENOENT",
			);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("taskkill の error と close が連続しても SIGTERM フォールバックは一度だけ送る", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 5152, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);
			taskkillProcess.__emit("error", new Error("spawn taskkill ENOENT"));
			taskkillProcess.__emit("close", 1);

			expect(child.kill).toHaveBeenCalledTimes(1);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("taskkill の非 0 終了を記録して SIGTERM にフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 5252, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);
			taskkillProcess.__emit("close", 1);

			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ taskkill exited with code 1",
			);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("taskkill の同期起動エラーを記録して SIGTERM にフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			Object.defineProperty(child, "pid", { value: 6161, configurable: true });
			mockSpawn.mockImplementationOnce(() => {
				throw new Error("spawn taskkill EACCES");
			});

			terminateProcessForCancellation(child, outputChannel as never);

			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ Failed to start taskkill: spawn taskkill EACCES",
			);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("Windows でも child.pid が未定義の場合は SIGTERM フォールバックを使う", () => {
		// spawn 直後で pid が割り当てられる前にキャンセルされた等のエッジケース。
		// taskkill は pid 引数を要求するため、未定義の場合は呼び出さず
		// ChildProcess.kill による標準終了に委ねる。
		setPlatform("win32");
		try {
			const child = createMockProcess();
			Object.defineProperty(child, "pid", {
				value: undefined,
				configurable: true,
			});

			terminateProcessForCancellation(child, outputChannel as never);

			expect(mockSpawn).not.toHaveBeenCalled();
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});

	it("taskkill が正常終了 (code 0) の場合は警告を出力しない", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 7373, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);
			taskkillProcess.__emit("close", 0);

			expect(outputChannel.appendLine).not.toHaveBeenCalled();
			expect(child.kill).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});

	it("taskkill が code null (シグナルキル) で終了した場合も警告を出して SIGTERM にフォールバックする", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 8484, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);
			taskkillProcess.__emit("close", null);

			expect(outputChannel.appendLine).toHaveBeenCalledWith(
				"\n⚠️ taskkill exited with code null",
			);
			expect(child.kill).toHaveBeenCalledWith("SIGTERM");
		} finally {
			restorePlatform();
		}
	});
});
