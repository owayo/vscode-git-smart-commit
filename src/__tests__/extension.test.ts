import { beforeEach, describe, expect, it, vi } from "vitest";
import type * as vscodeTypes from "vscode";

const mockRegisterCommand = vi.fn();
const mockCreateOutputChannel = vi.fn(() => ({
	show: vi.fn(),
	appendLine: vi.fn(),
	append: vi.fn(),
	dispose: vi.fn(),
}));
const mockCreateStatusBarItem = vi.fn(() => ({
	command: "",
	text: "",
	tooltip: "",
	show: vi.fn(),
	hide: vi.fn(),
	dispose: vi.fn(),
}));
const mockGetConfiguration = vi.fn(() => ({
	get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
}));
const mockOnDidChangeConfiguration = vi.fn();

vi.mock("vscode", () => ({
	window: {
		showErrorMessage: vi.fn(),
		showWarningMessage: vi.fn(),
		showQuickPick: vi.fn(),
		showInformationMessage: vi.fn(),
		withProgress: vi.fn(),
		createOutputChannel: mockCreateOutputChannel,
		createStatusBarItem: mockCreateStatusBarItem,
	},
	workspace: {
		workspaceFolders: undefined,
		getConfiguration: mockGetConfiguration,
		onDidChangeConfiguration: mockOnDidChangeConfiguration,
	},
	commands: {
		registerCommand: mockRegisterCommand,
		executeCommand: vi.fn(),
	},
	StatusBarAlignment: { Left: 1, Right: 2 },
	ProgressLocation: { Notification: 15 },
	Uri: { parse: vi.fn() },
	env: { openExternal: vi.fn() },
}));

vi.mock("child_process", () => ({
	spawn: vi.fn(),
	execSync: vi.fn(),
}));

describe("extension", () => {
	let activate: (context: vscodeTypes.ExtensionContext) => void;
	let deactivate: () => void;

	const mockContext = {
		subscriptions: [] as { dispose: () => void }[],
		push: vi.fn(),
	} as unknown as vscodeTypes.ExtensionContext;

	// Use subscriptions.push spy
	(mockContext.subscriptions as unknown[]) = [];

	beforeEach(async () => {
		vi.clearAllMocks();
		(mockContext.subscriptions as unknown[]) = [];
		const ext = await import("../extension");
		activate = ext.activate;
		deactivate = ext.deactivate;
	});

	it("should register all 5 commands on activate", () => {
		activate(mockContext);

		const registeredCommands = mockRegisterCommand.mock.calls.map(
			(call) => call[0],
		);
		expect(registeredCommands).toContain("git-smart-commit.runAddAutoConfirm");
		expect(registeredCommands).toContain(
			"git-smart-commit.runAddBodyAutoConfirm",
		);
		expect(registeredCommands).toContain("git-smart-commit.runAutoConfirm");
		expect(registeredCommands).toContain("git-smart-commit.runBodyAutoConfirm");
		expect(registeredCommands).toContain("git-smart-commit.reword");
	});

	it("should create an output channel", () => {
		activate(mockContext);

		expect(mockCreateOutputChannel).toHaveBeenCalledWith("Git Smart Commit");
	});

	it("should create a status bar item", () => {
		activate(mockContext);

		expect(mockCreateStatusBarItem).toHaveBeenCalled();
	});

	it("should register configuration change listener", () => {
		activate(mockContext);

		expect(mockOnDidChangeConfiguration).toHaveBeenCalled();
	});

	it("should add disposables to context subscriptions", () => {
		activate(mockContext);

		// 5 commands + 1 status bar item + 1 config change listener
		expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(7);
	});

	it("should deactivate without error", () => {
		activate(mockContext);
		expect(() => deactivate()).not.toThrow();
	});
});
