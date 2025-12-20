"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getRecentCommits = getRecentCommits;
exports.rewordCommit = rewordCommit;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
function getRecentCommits(workspaceRoot, limit = 10) {
    try {
        const output = (0, child_process_1.execSync)(`git log --oneline --format="%h|%s|%cr|%an" -n ${limit}`, {
            cwd: workspaceRoot,
            encoding: "utf-8",
        });
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
    }
    catch {
        return [];
    }
}
async function rewordCommit(outputChannel) {
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
    const items = commits.map((commit) => ({
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
async function runGitScReword(outputChannel, workspaceRoot, hash) {
    const { spawn } = await Promise.resolve().then(() => __importStar(require("child_process")));
    outputChannel.show(true);
    outputChannel.appendLine(`\n${"=".repeat(50)}`);
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Running: git-sc --reword ${hash} -y`);
    outputChannel.appendLine(`Working directory: ${workspaceRoot}`);
    outputChannel.appendLine("=".repeat(50));
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Git Smart Commit",
        cancellable: true,
    }, async (progress, token) => {
        return new Promise((resolve, reject) => {
            progress.report({ message: `Rewording commit ${hash}...` });
            const process = spawn("git-sc", ["--reword", hash, "-y"], {
                cwd: workspaceRoot,
                shell: true,
                env: { ...globalThis.process.env, FORCE_COLOR: "0" },
            });
            let stderr = "";
            process.stdout.on("data", (data) => {
                outputChannel.append(data.toString());
            });
            process.stderr.on("data", (data) => {
                const text = data.toString();
                stderr += text;
                outputChannel.append(text);
            });
            process.on("close", (code) => {
                if (code === 0) {
                    outputChannel.appendLine(`\n✅ Reword completed successfully`);
                    vscode.window.showInformationMessage("Commit reworded successfully!");
                    vscode.commands.executeCommand("git.refresh");
                    resolve();
                }
                else {
                    outputChannel.appendLine(`\n❌ Reword failed with code ${code}`);
                    vscode.window.showErrorMessage(`Reword failed: ${stderr.substring(0, 100)}`);
                    reject(new Error(stderr));
                }
            });
            process.on("error", (err) => {
                outputChannel.appendLine(`\n❌ Failed to start git-sc: ${err.message}`);
                vscode.window.showErrorMessage(`Failed to run git-sc: ${err.message}`);
                reject(err);
            });
            token.onCancellationRequested(() => {
                process.kill();
                outputChannel.appendLine("\n⚠️ Reword cancelled by user");
                resolve();
            });
        });
    });
}
//# sourceMappingURL=rewordCommit.js.map