import * as vscode from "vscode";
import { rewordCommit } from "./commands/rewordCommit";
import { runGitSc } from "./commands/runGitSc";

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
	outputChannel = vscode.window.createOutputChannel("Git Smart Commit");

	// Register commands
	// -a -y
	const runAddAutoConfirmCommand = vscode.commands.registerCommand(
		"git-smart-commit.runAddAutoConfirm",
		async () => {
			try {
				await runGitSc(outputChannel, { stageAll: true, autoConfirm: true });
			} catch {
				// Error already handled in runGitSc
			}
		},
	);

	// -a -b -y
	const runAddBodyAutoConfirmCommand = vscode.commands.registerCommand(
		"git-smart-commit.runAddBodyAutoConfirm",
		async () => {
			try {
				await runGitSc(outputChannel, {
					stageAll: true,
					includeBody: true,
					autoConfirm: true,
				});
			} catch {
				// Error already handled in runGitSc
			}
		},
	);

	// -y
	const runAutoConfirmCommand = vscode.commands.registerCommand(
		"git-smart-commit.runAutoConfirm",
		async () => {
			try {
				await runGitSc(outputChannel, { autoConfirm: true });
			} catch {
				// Error already handled in runGitSc
			}
		},
	);

	// -b -y
	const runBodyAutoConfirmCommand = vscode.commands.registerCommand(
		"git-smart-commit.runBodyAutoConfirm",
		async () => {
			try {
				await runGitSc(outputChannel, { includeBody: true, autoConfirm: true });
			} catch {
				// Error already handled in runGitSc
			}
		},
	);

	// Reword (QuickPick selection)
	const rewordCommand = vscode.commands.registerCommand(
		"git-smart-commit.reword",
		async () => {
			try {
				await rewordCommit(outputChannel);
			} catch {
				// Error already handled in rewordCommit
			}
		},
	);

	context.subscriptions.push(
		runAddAutoConfirmCommand,
		runAddBodyAutoConfirmCommand,
		runAutoConfirmCommand,
		runBodyAutoConfirmCommand,
		rewordCommand,
	);

	// Create status bar item
	createStatusBarItem(context);

	// Watch for configuration changes
	context.subscriptions.push(
		vscode.workspace.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration("gitSmartCommit.showStatusBarButton")) {
				updateStatusBarVisibility();
			}
		}),
	);

	outputChannel.appendLine("Git Smart Commit extension activated");
}

function createStatusBarItem(context: vscode.ExtensionContext): void {
	statusBarItem = vscode.window.createStatusBarItem(
		vscode.StatusBarAlignment.Left,
		100,
	);

	statusBarItem.command = "git-smart-commit.runAddAutoConfirm";
	statusBarItem.text = "$(sparkle) git-sc";
	statusBarItem.tooltip = "Git Smart Commit (-a -y)";

	context.subscriptions.push(statusBarItem);
	updateStatusBarVisibility();
}

function updateStatusBarVisibility(): void {
	if (!statusBarItem) {
		return;
	}

	const config = vscode.workspace.getConfiguration("gitSmartCommit");
	const showButton = config.get<boolean>("showStatusBarButton", true);

	if (showButton) {
		statusBarItem.show();
	} else {
		statusBarItem.hide();
	}
}

export function deactivate(): void {
	outputChannel?.dispose();
}
