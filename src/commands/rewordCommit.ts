import { execFileSync } from "child_process";
import * as vscode from "vscode";
import { getGitWorkspaceRoot } from "./getGitWorkspaceRoot";
import { resolveNativeExecutableOnPath } from "./resolveExecutablePath";
import { spawnGitScWithProgress } from "./spawnGitScProcess";

export interface CommitInfo {
	index: number;
	hash: string;
	message: string;
	date: string;
	author: string;
}

const GIT_LOG_SEPARATOR = "\x00";

function resolveGitExecutable(): string {
	const gitCommand = resolveNativeExecutableOnPath("git");
	if (!gitCommand) {
		throw new Error("spawn git ENOENT");
	}
	return gitCommand;
}

function getCommitCount(workspaceRoot: string): number | null {
	try {
		const gitCommand = resolveGitExecutable();
		// git 実行ファイルは絶対パスで起動し、対象リポジトリは `-C <dir>` で渡す。
		// bare command と cwd 指定を組み合わせないことで、偽 `git.exe` の探索余地を断つ。
		const output = execFileSync(
			gitCommand,
			["-C", workspaceRoot, "rev-list", "--count", "--all"],
			{
				encoding: "utf-8",
			},
		).trim();
		const count = Number.parseInt(output, 10);
		return Number.isNaN(count) ? null : count;
	} catch {
		return null;
	}
}

export function getRecentCommits(
	workspaceRoot: string,
	limit: number = 10,
): CommitInfo[] {
	const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
	const gitCommand = resolveGitExecutable();
	let output: string;
	try {
		// git 実行ファイルは絶対パスで起動し、対象リポジトリは `-C <dir>` で渡す。
		// bare command と cwd 指定を組み合わせないことで、偽 `git.exe` の探索余地を断つ。
		output = execFileSync(
			gitCommand,
			[
				"-C",
				workspaceRoot,
				"log",
				"--format=format:%h%x00%s%x00%cr%x00%an%x00",
				"-n",
				String(safeLimit),
			],
			{
				encoding: "utf-8",
			},
		);
	} catch (error) {
		if (getCommitCount(workspaceRoot) === 0) {
			return [];
		}
		throw error;
	}

	const fields = output.split(GIT_LOG_SEPARATOR);
	const commits: CommitInfo[] = [];

	for (
		let index = 0, fieldIndex = 0;
		fieldIndex + 3 < fields.length;
		index += 1
	) {
		// format: はコミット間に改行セパレータを挿入するため、
		// 2番目以降のハッシュ先頭に改行が混入する → 先頭の改行のみ除去
		const hash = (fields[fieldIndex] ?? "").replace(/^\n/, "");
		const message = fields[fieldIndex + 1] ?? "";
		const date = fields[fieldIndex + 2] ?? "";
		const author = fields[fieldIndex + 3] ?? "";
		fieldIndex += 4;

		commits.push({
			index: index + 1, // git-sc --reword 向けの 1 始まりインデックス
			hash,
			message,
			date,
			author,
		});
	}

	return commits;
}

export async function rewordCommit(
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("No workspace folder open");
		return;
	}

	let workspaceRoot: string | null;
	try {
		workspaceRoot = getGitWorkspaceRoot(workspaceFolders);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		if (message.includes("ENOENT")) {
			vscode.window.showErrorMessage(
				"Git command not found. Please install Git and ensure it's in your PATH.",
			);
		} else {
			vscode.window.showErrorMessage(
				`Failed to detect Git repository: ${message.substring(0, 100)}`,
			);
		}
		return;
	}
	if (!workspaceRoot) {
		vscode.window.showErrorMessage("No Git repository found in open workspace");
		return;
	}

	// 直近コミットを取得
	let commits: CommitInfo[];
	try {
		commits = getRecentCommits(workspaceRoot, 15);
	} catch (error) {
		const errorMessage = error instanceof Error ? error.message : String(error);
		outputChannel.appendLine(
			`\n❌ Failed to load commit history: ${errorMessage}`,
		);

		if (errorMessage.includes("ENOENT")) {
			vscode.window.showErrorMessage(
				"Git command not found. Please install Git and ensure it's in your PATH.",
			);
		} else {
			vscode.window.showErrorMessage(
				`Failed to load commit history: ${errorMessage.substring(0, 100)}`,
			);
		}
		return;
	}

	if (commits.length === 0) {
		vscode.window.showWarningMessage("No commits found in this repository");
		return;
	}

	// QuickPick の候補を作成
	const items: Array<vscode.QuickPickItem & { commit: CommitInfo }> =
		commits.map((commit) => ({
			label: `$(git-commit) ${commit.message}`,
			description: `${commit.hash} • ${commit.date}`,
			detail: `${commit.index - 1} commit(s) ago • by ${commit.author}`,
			commit,
		}));

	// QuickPick を表示
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: "Select a commit to reword",
		title: "Git Smart Commit: Reword",
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!selected) {
		return; // ユーザーがキャンセル
	}

	const commit = selected.commit;

	// 選択内容を確認
	const confirm = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: `Reword commit "${commit.message.substring(0, 50)}${commit.message.length > 50 ? "..." : ""}"?`,
		title: "Confirm Reword",
	});

	if (confirm !== "Yes") {
		return;
	}

	// 選択したコミットハッシュで git-sc --reword を実行
	await runGitScReword(outputChannel, workspaceRoot, commit.hash);
}

async function runGitScReword(
	outputChannel: vscode.OutputChannel,
	workspaceRoot: string,
	hash: string,
): Promise<void> {
	// spawn / 進捗表示 / キャンセル処理は commit フローと共通のヘルパーに委譲し、
	// reword フロー固有の引数と表示文言だけを渡す。
	return spawnGitScWithProgress({
		outputChannel,
		workspaceRoot,
		args: ["--reword", hash, "-y"],
		messages: {
			progressMessage: `Rewording commit ${hash}...`,
			successOutputLine: "✅ Reword completed successfully",
			successNotification: "Commit reworded successfully!",
			failureOutputPrefix: "Reword failed",
			failureNotificationPrefix: "Reword failed",
			cancellationOutputLine: "⚠️ Reword cancelled by user",
		},
	});
}
