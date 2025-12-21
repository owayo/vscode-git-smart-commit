import { execFileSync, spawn } from "child_process";
import * as vscode from "vscode";
import { isCommandNotFoundError } from "./isCommandNotFoundError";

export interface CommitInfo {
	index: number;
	hash: string;
	message: string;
	date: string;
	author: string;
}

const GIT_SC_INSTALLATION_URL =
	"https://github.com/owayo/git-smart-commit#installation";
const GIT_LOG_FIELD_SEPARATOR = "\x1f";
const GIT_LOG_RECORD_SEPARATOR = "\x1e";

function showGitScNotFoundMessage(): void {
	vscode.window
		.showErrorMessage(
			"git-sc command not found. Please install it and ensure it's in your PATH.",
			"View Installation",
		)
		.then((selection) => {
			if (selection === "View Installation") {
				vscode.env.openExternal(vscode.Uri.parse(GIT_SC_INSTALLATION_URL));
			}
		});
}

export function getRecentCommits(
	workspaceRoot: string,
	limit: number = 10,
): CommitInfo[] {
	const safeLimit = Number.isInteger(limit) && limit > 0 ? limit : 10;
	const output = execFileSync(
		"git",
		[
			"log",
			`--format=%h${GIT_LOG_FIELD_SEPARATOR}%s${GIT_LOG_FIELD_SEPARATOR}%cr${GIT_LOG_FIELD_SEPARATOR}%an${GIT_LOG_RECORD_SEPARATOR}`,
			"-n",
			String(safeLimit),
		],
		{
			cwd: workspaceRoot,
			encoding: "utf-8",
		},
	);

	return output
		.split(GIT_LOG_RECORD_SEPARATOR)
		.map((line) => line.trim())
		.filter((line) => line.length > 0)
		.map((line, index) => {
			const [hash = "", message = "", date = "", author = ""] = line.split(
				GIT_LOG_FIELD_SEPARATOR,
			);
			return {
				index: index + 1, // 1-based index for git-sc --reword
				hash,
				message,
				date,
				author,
			};
		});
}

export async function rewordCommit(
	outputChannel: vscode.OutputChannel,
): Promise<void> {
	const workspaceFolders = vscode.workspace.workspaceFolders;

	if (!workspaceFolders || workspaceFolders.length === 0) {
		vscode.window.showErrorMessage("No workspace folder open");
		return;
	}

	const workspaceRoot = workspaceFolders[0].uri.fsPath;

	// Get recent commits
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

	// Create QuickPick items
	const items: Array<vscode.QuickPickItem & { commit: CommitInfo }> =
		commits.map((commit) => ({
			label: `$(git-commit) ${commit.message}`,
			description: `${commit.hash} • ${commit.date}`,
			detail: `${commit.index - 1} commit(s) ago • by ${commit.author}`,
			commit,
		}));

	// Show QuickPick
	const selected = await vscode.window.showQuickPick(items, {
		placeHolder: "Select a commit to reword",
		title: "Git Smart Commit: Reword",
		matchOnDescription: true,
		matchOnDetail: true,
	});

	if (!selected) {
		return; // User cancelled
	}

	const commit = selected.commit;

	// Confirm the selection
	const confirm = await vscode.window.showQuickPick(["Yes", "No"], {
		placeHolder: `Reword commit "${commit.message.substring(0, 50)}${commit.message.length > 50 ? "..." : ""}"?`,
		title: "Confirm Reword",
	});

	if (confirm !== "Yes") {
		return;
	}

	// Run git-sc --reword with commit hash
	await runGitScReword(outputChannel, workspaceRoot, commit.hash);
}

async function runGitScReword(
	outputChannel: vscode.OutputChannel,
	workspaceRoot: string,
	hash: string,
): Promise<void> {
	outputChannel.show(true);
	outputChannel.appendLine(`\n${"=".repeat(50)}`);
	outputChannel.appendLine(
		`[${new Date().toLocaleTimeString()}] Running: git-sc --reword ${hash} -y`,
	);
	outputChannel.appendLine(`Working directory: ${workspaceRoot}`);
	outputChannel.appendLine("=".repeat(50));

	return vscode.window.withProgress(
		{
			location: vscode.ProgressLocation.Notification,
			title: "Git Smart Commit",
			cancellable: true,
		},
		async (progress, token) => {
			return new Promise<void>((resolve, reject) => {
				let isCancelled = false;
				let settled = false;

				const resolveOnce = (): void => {
					if (!settled) {
						settled = true;
						resolve();
					}
				};

				const rejectOnce = (error: Error): void => {
					if (!settled) {
						settled = true;
						reject(error);
					}
				};

				progress.report({ message: `Rewording commit ${hash}...` });

				const process = spawn("git-sc", ["--reword", hash, "-y"], {
					cwd: workspaceRoot,
					shell: true,
					env: { ...globalThis.process.env, FORCE_COLOR: "0" },
				});

				let stdout = "";
				let stderr = "";

				process.stdout.on("data", (data: Buffer) => {
					const text = data.toString();
					stdout += text;
					outputChannel.append(text);
				});

				process.stderr.on("data", (data: Buffer) => {
					const text = data.toString();
					stderr += text;
					outputChannel.append(text);
				});

				process.on("close", (code: number | null) => {
					if (isCancelled) {
						resolveOnce();
						return;
					}

					if (code === 0) {
						outputChannel.appendLine(`\n✅ Reword completed successfully`);
						vscode.window.showInformationMessage(
							"Commit reworded successfully!",
						);
						vscode.commands.executeCommand("git.refresh");
						resolveOnce();
					} else {
						const errorMessage =
							stderr || stdout || `Process exited with code ${code}`;
						outputChannel.appendLine(`\n❌ Reword failed with code ${code}`);
						if (isCommandNotFoundError(code, errorMessage)) {
							showGitScNotFoundMessage();
						} else {
							vscode.window.showErrorMessage(
								`Reword failed: ${errorMessage.substring(0, 100)}`,
							);
						}
						rejectOnce(new Error(errorMessage));
					}
				});

				process.on("error", (err: Error) => {
					if (isCancelled) {
						resolveOnce();
						return;
					}

					outputChannel.appendLine(
						`\n❌ Failed to start git-sc: ${err.message}`,
					);
					if (err.message.includes("ENOENT")) {
						showGitScNotFoundMessage();
					} else {
						vscode.window.showErrorMessage(
							`Failed to run git-sc: ${err.message}`,
						);
					}
					rejectOnce(err);
				});

				token.onCancellationRequested(() => {
					isCancelled = true;
					process.kill();
					outputChannel.appendLine("\n⚠️ Reword cancelled by user");
					resolveOnce();
				});
			});
		},
	);
}
