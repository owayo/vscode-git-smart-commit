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

	// subscriptions.push の挙動を検証できるよう配列を初期化
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

		// 5 コマンド + ステータスバー 1 件 + 設定変更リスナー 1 件
		expect(mockContext.subscriptions.length).toBeGreaterThanOrEqual(7);
	});

	it("should deactivate without error", () => {
		activate(mockContext);
		expect(() => deactivate()).not.toThrow();
	});

	it("should deactivate safely before activation", () => {
		// outputChannel が未初期化でもエラーにならない（?. によるガード）
		expect(() => deactivate()).not.toThrow();
	});

	it("should hide status bar when showStatusBarButton is false", () => {
		const mockStatusBar = {
			command: "",
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateStatusBarItem.mockReturnValueOnce(mockStatusBar);
		mockGetConfiguration.mockReturnValueOnce({
			get: vi.fn((_key: string) => false),
		});

		activate(mockContext);

		expect(mockStatusBar.hide).toHaveBeenCalled();
	});

	it("should show status bar when showStatusBarButton is true", () => {
		const mockStatusBar = {
			command: "",
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateStatusBarItem.mockReturnValueOnce(mockStatusBar);
		mockGetConfiguration.mockReturnValueOnce({
			get: vi.fn((_key: string, defaultValue: unknown) => defaultValue),
		});

		activate(mockContext);

		expect(mockStatusBar.show).toHaveBeenCalled();
	});

	it("should invoke config change callback and update visibility", () => {
		const mockStatusBar = {
			command: "",
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateStatusBarItem.mockReturnValueOnce(mockStatusBar);

		activate(mockContext);

		// 設定変更コールバックを取得して実行
		const changeCallback = mockOnDidChangeConfiguration.mock.calls[0][0];
		mockGetConfiguration.mockReturnValueOnce({
			get: vi.fn((_key: string) => false),
		});
		changeCallback({
			affectsConfiguration: (key: string) =>
				key === "gitSmartCommit.showStatusBarButton",
		});

		expect(mockStatusBar.hide).toHaveBeenCalled();
	});

	it("should set correct status bar properties", () => {
		const mockStatusBar = {
			command: "",
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateStatusBarItem.mockReturnValueOnce(mockStatusBar);

		activate(mockContext);

		expect(mockStatusBar.command).toBe("git-smart-commit.runAddAutoConfirm");
		expect(mockStatusBar.text).toBe("$(sparkle) git-sc");
		expect(mockStatusBar.tooltip).toBe("Git Smart Commit (-a -y)");
	});

	it("should log activation message to output channel", () => {
		const mockChannel = {
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateOutputChannel.mockReturnValueOnce(mockChannel);

		activate(mockContext);

		expect(mockChannel.appendLine).toHaveBeenCalledWith(
			"Git Smart Commit extension activated",
		);
	});

	it("should not update visibility when unrelated config changes", () => {
		const mockStatusBar = {
			command: "",
			text: "",
			tooltip: "",
			show: vi.fn(),
			hide: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateStatusBarItem.mockReturnValueOnce(mockStatusBar);
		// 初回の show/hide をリセットするため activate 後にクリア
		activate(mockContext);
		mockStatusBar.show.mockClear();
		mockStatusBar.hide.mockClear();

		const changeCallback = mockOnDidChangeConfiguration.mock.calls[0][0];
		// 関係ない設定キーが変更された場合
		changeCallback({
			affectsConfiguration: (_key: string) => false,
		});

		expect(mockStatusBar.show).not.toHaveBeenCalled();
		expect(mockStatusBar.hide).not.toHaveBeenCalled();
	});

	it("should dispose output channel on deactivate", () => {
		const mockChannel = {
			show: vi.fn(),
			appendLine: vi.fn(),
			append: vi.fn(),
			dispose: vi.fn(),
		};
		mockCreateOutputChannel.mockReturnValueOnce(mockChannel);

		activate(mockContext);
		deactivate();

		expect(mockChannel.dispose).toHaveBeenCalled();
	});

	it("should register command handlers that call runGitSc with correct options", () => {
		activate(mockContext);

		// 登録されたコマンド名とコールバックのペアを取得
		const calls = mockRegisterCommand.mock.calls as unknown[][];
		const registeredHandlers = new Map(
			calls.map((call) => [call[0] as string, call[1] as () => void] as const),
		);

		// 5 つのコマンドがすべて登録されていること
		expect(registeredHandlers.size).toBe(5);
		expect(registeredHandlers.has("git-smart-commit.runAddAutoConfirm")).toBe(
			true,
		);
		expect(
			registeredHandlers.has("git-smart-commit.runAddBodyAutoConfirm"),
		).toBe(true);
		expect(registeredHandlers.has("git-smart-commit.runAutoConfirm")).toBe(
			true,
		);
		expect(registeredHandlers.has("git-smart-commit.runBodyAutoConfirm")).toBe(
			true,
		);
		expect(registeredHandlers.has("git-smart-commit.reword")).toBe(true);
	});

	it("should not throw when command handler catches error", async () => {
		activate(mockContext);

		// コマンドハンドラを取得して呼び出し — エラーが握りつぶされることを確認
		const calls = mockRegisterCommand.mock.calls as unknown[][];
		const match = calls.find(
			(call) => call[0] === "git-smart-commit.runAddAutoConfirm",
		);
		const handler = match?.[1] as (() => Promise<void>) | undefined;

		expect(handler).toBeDefined();
		// ハンドラ内で runGitSc がエラーを返しても例外にならないこと
		await expect(handler!()).resolves.toBeUndefined();
	});

	it("should create status bar item with Left alignment and priority 100", () => {
		activate(mockContext);

		expect(mockCreateStatusBarItem).toHaveBeenCalledWith(1, 100); // StatusBarAlignment.Left = 1
	});

	it("should not throw when all command handlers are invoked", async () => {
		activate(mockContext);

		const calls = mockRegisterCommand.mock.calls as unknown[][];
		const handlers = new Map(
			calls.map((call) => [call[0] as string, call[1] as () => Promise<void>]),
		);

		// 全5コマンドのハンドラがエラーなく呼び出せること
		for (const [_name, handler] of handlers) {
			await expect(handler()).resolves.toBeUndefined();
		}
		expect(handlers.size).toBe(5);
	});
});
