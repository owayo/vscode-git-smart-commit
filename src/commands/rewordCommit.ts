import { execFileSync } from "child_process";
import * as vscode from "vscode";
import { resolveGitExecutable } from "./gitExecutable";
import {
	resolveCommandWorkspaceRoot,
	showGitCommandError,
} from "./resolveCommandWorkspaceRoot";
import { spawnGitScWithProgress } from "./spawnGitScProcess";

export interface CommitInfo {
	index: number;
	/**
	 * git-sc --reword に渡す完全なコミットハッシュ。短縮ハッシュは同名のタグやブランチが
	 * あると `git rev-parse` でそちらに解決され、選んだものとは別のコミットを書き換える。
	 */
	hash: string;
	/** 一覧や進捗に表示する短縮ハッシュ (git log の %h) */
	shortHash: string;
	message: string;
	date: string;
	author: string;
}

const GIT_LOG_SEPARATOR = "\x00";

/** 到達可能なコミットの有無だけを調べ、判定不能なら元の履歴取得エラーを保持する。 */
function hasReachableCommit(
	gitCommand: string,
	workspaceRoot: string,
): boolean | null {
	try {
		// 空かどうかの確認に全履歴を数えない。orphan HEAD でも他の ref は確認する。
		const output = execFileSync(
			gitCommand,
			["-C", workspaceRoot, "rev-list", "--count", "--max-count=1", "--all"],
			{ encoding: "utf-8" },
		).trim();
		return output === "0" ? false : output === "1" ? true : null;
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
				// log.showSignature の検証結果がハッシュ欄へ混入するのを防ぐ。
				"--no-show-signature",
				// i18n.logOutputEncoding (例: Shift_JIS) の設定に関わらず UTF-8 で出力させる。
				// 指定しないと件名や作者名を UTF-8 として読んだときに文字化けする。
				"--encoding=UTF-8",
				// 実行用の完全なハッシュと表示用の短縮ハッシュを別々に受け取る。
				"--format=format:%H%x00%h%x00%s%x00%cr%x00%an%x00",
				"-n",
				String(safeLimit),
			],
			{
				encoding: "utf-8",
			},
		);
	} catch (error) {
		if (hasReachableCommit(gitCommand, workspaceRoot) === false) {
			return [];
		}
		throw error;
	}

	const fields = output.split(GIT_LOG_SEPARATOR);
	const commits: CommitInfo[] = [];

	for (
		let index = 0, fieldIndex = 0;
		fieldIndex + 4 < fields.length;
		index += 1
	) {
		// format: はコミット間に改行セパレータを挿入するため、
		// 2番目以降のハッシュ先頭に改行が混入する → 先頭の改行のみ除去
		const hash = (fields[fieldIndex] ?? "").replace(/^\n/, "");
		const shortHash = fields[fieldIndex + 1] ?? "";
		const message = fields[fieldIndex + 2] ?? "";
		const date = fields[fieldIndex + 3] ?? "";
		const author = fields[fieldIndex + 4] ?? "";
		fieldIndex += 5;

		commits.push({
			index: index + 1, // git-sc --reword 向けの 1 始まりインデックス
			hash,
			shortHash,
			message,
			date,
			author,
		});
	}

	return commits;
}

export async function rewordCommit(
	outputChannel: vscode.OutputChannel,
	targetUri?: vscode.Uri,
): Promise<void> {
	const workspaceRoot = resolveCommandWorkspaceRoot(targetUri);
	if (!workspaceRoot) {
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
		showGitCommandError("Failed to load commit history", error);
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
			description: `${commit.shortHash} • ${commit.date}`,
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

	// 選択したコミットの完全なハッシュで git-sc --reword を実行
	await runGitScReword(outputChannel, workspaceRoot, commit);
}

async function runGitScReword(
	outputChannel: vscode.OutputChannel,
	workspaceRoot: string,
	commit: CommitInfo,
): Promise<void> {
	// spawn / 進捗表示 / キャンセル処理は commit フローと共通のヘルパーに委譲し、
	// reword フロー固有の引数と表示文言だけを渡す。
	return spawnGitScWithProgress({
		outputChannel,
		workspaceRoot,
		args: ["--reword", commit.hash, "-y"],
		messages: {
			progressMessage: `Rewording commit ${commit.shortHash}...`,
			successOutputLine: "✅ Reword completed successfully",
			successNotification: "Commit reworded successfully!",
			failureOutputPrefix: "Reword failed",
			failureNotificationPrefix: "Reword failed",
			cancellationOutputLine: "⚠️ Reword cancelled by user",
		},
	});
}
