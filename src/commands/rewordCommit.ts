import * as vscode from "vscode";
import { execSync } from "child_process";

export interface CommitInfo {
  index: number;
  hash: string;
  message: string;
  date: string;
  author: string;
}

export function getRecentCommits(
  workspaceRoot: string,
  limit: number = 10,
): CommitInfo[] {
  try {
    const output = execSync(
      `git log --oneline --format="%h|%s|%cr|%an" -n ${limit}`,
      {
        cwd: workspaceRoot,
        encoding: "utf-8",
      },
    );

    return output
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line, index) => {
        const [hash, message, date, author] = line.split("|");
        return {
          index: index + 1, // 1-based index for git-sc --reword
          hash,
          message,
          date,
          author,
        };
      });
  } catch {
    return [];
  }
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
  const commits = getRecentCommits(workspaceRoot, 15);

  if (commits.length === 0) {
    vscode.window.showWarningMessage("No commits found in this repository");
    return;
  }

  // Create QuickPick items
  const items: vscode.QuickPickItem[] = commits.map((commit) => ({
    label: `$(git-commit) ${commit.message}`,
    description: `${commit.hash} • ${commit.date}`,
    detail: `${commit.index} commit(s) ago • by ${commit.author}`,
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

  // Find the selected commit index
  const selectedIndex = items.indexOf(selected);
  const commit = commits[selectedIndex];

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
  const { spawn } = await import("child_process");

  outputChannel.show(true);
  outputChannel.appendLine(`\n${"=".repeat(50)}`);
  outputChannel.appendLine(
    `[${new Date().toLocaleTimeString()}] Running: git-sc --reword ${hash}`,
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
        progress.report({ message: `Rewording commit ${hash}...` });

        const process = spawn("git-sc", ["--reword", hash], {
          cwd: workspaceRoot,
          shell: true,
          env: { ...globalThis.process.env, FORCE_COLOR: "0" },
        });

        let stderr = "";

        process.stdout.on("data", (data: Buffer) => {
          outputChannel.append(data.toString());
        });

        process.stderr.on("data", (data: Buffer) => {
          const text = data.toString();
          stderr += text;
          outputChannel.append(text);
        });

        process.on("close", (code: number | null) => {
          if (code === 0) {
            outputChannel.appendLine(`\n✅ Reword completed successfully`);
            vscode.window.showInformationMessage(
              "Commit reworded successfully!",
            );
            vscode.commands.executeCommand("git.refresh");
            resolve();
          } else {
            outputChannel.appendLine(`\n❌ Reword failed with code ${code}`);
            vscode.window.showErrorMessage(
              `Reword failed: ${stderr.substring(0, 100)}`,
            );
            reject(new Error(stderr));
          }
        });

        process.on("error", (err: Error) => {
          outputChannel.appendLine(
            `\n❌ Failed to start git-sc: ${err.message}`,
          );
          vscode.window.showErrorMessage(
            `Failed to run git-sc: ${err.message}`,
          );
          reject(err);
        });

        token.onCancellationRequested(() => {
          process.kill();
          outputChannel.appendLine("\n⚠️ Reword cancelled by user");
          resolve();
        });
      });
    },
  );
}
