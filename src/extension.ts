import * as vscode from "vscode";
import { rewordCommit } from "./commands/rewordCommit";
import { type GitScOptions, runGitSc } from "./commands/runGitSc";
import { terminateActiveGitScProcesses } from "./commands/spawnGitScProcess";

/**
 * commit フローのコマンド ID と、git-sc へ渡すオプションの対応。
 * package.json の contributes.commands と同じ順に並べる。
 */
const COMMIT_COMMANDS: readonly {
	readonly id: string;
	readonly options: Readonly<GitScOptions>;
}[] = [
	// ステージ全件 + 自動確定 (-a -y)
	{
		id: "git-smart-commit.runAddAutoConfirm",
		options: { stageAll: true, autoConfirm: true },
	},
	// ステージ全件 + 本文付き + 自動確定 (-a -b -y)
	{
		id: "git-smart-commit.runAddBodyAutoConfirm",
		options: { stageAll: true, includeBody: true, autoConfirm: true },
	},
	// 自動確定のみ (-y)
	{
		id: "git-smart-commit.runAutoConfirm",
		options: { autoConfirm: true },
	},
	// 本文付き + 自動確定 (-b -y)
	{
		id: "git-smart-commit.runBodyAutoConfirm",
		options: { includeBody: true, autoConfirm: true },
	},
];

let statusBarItem: vscode.StatusBarItem | undefined;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext): void {
	outputChannel = vscode.window.createOutputChannel("Git Smart Commit");

	// コマンドを登録する。SCM のメニューから呼ばれた場合は、選ばれたリポジトリを対象にする
	for (const { id, options } of COMMIT_COMMANDS) {
		context.subscriptions.push(
			vscode.commands.registerCommand(
				id,
				async (sourceControl?: vscode.SourceControl) => {
					try {
						await runGitSc(outputChannel, options, sourceControl?.rootUri);
					} catch {
						// runGitSc 側でエラー表示済み
					}
				},
			),
		);
	}

	// コミット文面の修正（QuickPick で対象を選択）
	context.subscriptions.push(
		vscode.commands.registerCommand(
			"git-smart-commit.reword",
			async (sourceControl?: vscode.SourceControl) => {
				try {
					await rewordCommit(outputChannel, sourceControl?.rootUri);
				} catch {
					// rewordCommit 側でエラー表示済み
				}
			},
		),
	);

	// ステータスバー項目を作成
	createStatusBarItem(context);

	// 設定変更を監視
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
	// VS Code の reload / 終了 / 拡張停止時に、実行中の git-sc とその子孫プロセスを
	// 取り残さないよう終了させる。outputChannel は cleanup のログ出力先になるため
	// dispose する前に渡す。
	if (outputChannel) {
		terminateActiveGitScProcesses(outputChannel);
	}
	outputChannel?.dispose();
}
