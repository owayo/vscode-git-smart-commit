import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockSpawn = vi.fn();

vi.mock("child_process", () => ({
	spawn: (...args: unknown[]) => mockSpawn(...args),
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

	it("Windows では taskkill でプロセスツリーを終了する", () => {
		setPlatform("win32");
		try {
			const child = createMockProcess();
			const taskkillProcess = createMockProcess();
			Object.defineProperty(child, "pid", { value: 4242, configurable: true });
			mockSpawn.mockReturnValueOnce(taskkillProcess);

			terminateProcessForCancellation(child, outputChannel as never);

			expect(mockSpawn).toHaveBeenCalledWith(
				"taskkill",
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

	it("taskkill の非同期起動エラーを outputChannel に記録する", () => {
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
			expect(child.kill).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});

	it("taskkill の同期起動エラーを outputChannel に記録する", () => {
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
			expect(child.kill).not.toHaveBeenCalled();
		} finally {
			restorePlatform();
		}
	});
});
