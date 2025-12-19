import * as vscode from "vscode";
import { spawn } from "child_process";

export interface GitScOptions {
  stageAll?: boolean;
  autoConfirm?: boolean;
  includeBody?: boolean;
}

export async function runGitSc(
  outputChannel: vscode.OutputChannel,
  options: GitScOptions = {},
): Promise<void> {
  const workspaceFolders = vscode.workspace.workspaceFolders;

  if (!workspaceFolders || workspaceFolders.length === 0) {
    vscode.window.showErrorMessage("No workspace folder open");
    return;
  }

  const workspaceRoot = workspaceFolders[0].uri.fsPath;
  const config = vscode.workspace.getConfiguration("gitSmartCommit");

  // Build command arguments
  const args: string[] = [];

  if (options.stageAll) {
    args.push("-a");
  }

  if (options.includeBody ?? config.get<boolean>("includeBody", false)) {
    args.push("-b");
  }

  if (options.autoConfirm ?? config.get<boolean>("autoConfirm", false)) {
    args.push("-y");
  }

  outputChannel.show(true);
  outputChannel.appendLine(`\n${"=".repeat(50)}`);
  outputChannel.appendLine(
    `[${new Date().toLocaleTimeString()}] Running: git-sc ${args.join(" ")}`,
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
        progress.report({ message: "Generating commit message..." });

        const process = spawn("git-sc", args, {
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
          if (code === 0) {
            outputChannel.appendLine(`\n✅ git-sc completed successfully`);
            vscode.window.showInformationMessage("Git Smart Commit completed!");

            // Refresh git extension to show updated state
            vscode.commands.executeCommand("git.refresh");
            resolve();
          } else {
            const errorMessage =
              stderr || stdout || `Process exited with code ${code}`;
            outputChannel.appendLine(`\n❌ git-sc failed with code ${code}`);

            if (code === 127 || errorMessage.includes("not found")) {
              vscode.window
                .showErrorMessage(
                  "git-sc command not found. Please install it and ensure it's in your PATH.",
                  "View Installation",
                )
                .then((selection) => {
                  if (selection === "View Installation") {
                    vscode.env.openExternal(
                      vscode.Uri.parse(
                        "https://github.com/owayo/git-smart-commit#installation",
                      ),
                    );
                  }
                });
            } else {
              vscode.window.showErrorMessage(
                `Git Smart Commit failed: ${errorMessage.substring(0, 100)}`,
              );
            }
            reject(new Error(errorMessage));
          }
        });

        process.on("error", (err: Error) => {
          outputChannel.appendLine(
            `\n❌ Failed to start git-sc: ${err.message}`,
          );

          if (err.message.includes("ENOENT")) {
            vscode.window
              .showErrorMessage(
                "git-sc command not found. Please install it and ensure it's in your PATH.",
                "View Installation",
              )
              .then((selection) => {
                if (selection === "View Installation") {
                  vscode.env.openExternal(
                    vscode.Uri.parse(
                      "https://github.com/owayo/git-smart-commit#installation",
                    ),
                  );
                }
              });
          } else {
            vscode.window.showErrorMessage(
              `Failed to run git-sc: ${err.message}`,
            );
          }
          reject(err);
        });

        token.onCancellationRequested(() => {
          process.kill();
          outputChannel.appendLine("\n⚠️ git-sc cancelled by user");
          resolve();
        });
      });
    },
  );
}
