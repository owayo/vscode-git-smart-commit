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
exports.runGitSc = runGitSc;
const vscode = __importStar(require("vscode"));
const child_process_1 = require("child_process");
async function runGitSc(outputChannel, options = {}) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder open");
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;
    const config = vscode.workspace.getConfiguration("gitSmartCommit");
    // Build command arguments
    const args = [];
    if (options.stageAll) {
        args.push("-a");
    }
    if (options.includeBody ?? config.get("includeBody", false)) {
        args.push("-b");
    }
    if (options.autoConfirm ?? config.get("autoConfirm", false)) {
        args.push("-y");
    }
    outputChannel.show(true);
    outputChannel.appendLine(`\n${"=".repeat(50)}`);
    outputChannel.appendLine(`[${new Date().toLocaleTimeString()}] Running: git-sc ${args.join(" ")}`);
    outputChannel.appendLine(`Working directory: ${workspaceRoot}`);
    outputChannel.appendLine("=".repeat(50));
    return vscode.window.withProgress({
        location: vscode.ProgressLocation.Notification,
        title: "Git Smart Commit",
        cancellable: true,
    }, async (progress, token) => {
        return new Promise((resolve, reject) => {
            progress.report({ message: "Generating commit message..." });
            const process = (0, child_process_1.spawn)("git-sc", args, {
                cwd: workspaceRoot,
                shell: true,
                env: { ...globalThis.process.env, FORCE_COLOR: "0" },
            });
            let stdout = "";
            let stderr = "";
            process.stdout.on("data", (data) => {
                const text = data.toString();
                stdout += text;
                outputChannel.append(text);
            });
            process.stderr.on("data", (data) => {
                const text = data.toString();
                stderr += text;
                outputChannel.append(text);
            });
            process.on("close", (code) => {
                if (code === 0) {
                    outputChannel.appendLine(`\n✅ git-sc completed successfully`);
                    vscode.window.showInformationMessage("Git Smart Commit completed!");
                    // Refresh git extension to show updated state
                    vscode.commands.executeCommand("git.refresh");
                    resolve();
                }
                else {
                    const errorMessage = stderr || stdout || `Process exited with code ${code}`;
                    outputChannel.appendLine(`\n❌ git-sc failed with code ${code}`);
                    if (code === 127 || errorMessage.includes("not found")) {
                        vscode.window
                            .showErrorMessage("git-sc command not found. Please install it and ensure it's in your PATH.", "View Installation")
                            .then((selection) => {
                            if (selection === "View Installation") {
                                vscode.env.openExternal(vscode.Uri.parse("https://github.com/owayo/git-smart-commit#installation"));
                            }
                        });
                    }
                    else {
                        vscode.window.showErrorMessage(`Git Smart Commit failed: ${errorMessage.substring(0, 100)}`);
                    }
                    reject(new Error(errorMessage));
                }
            });
            process.on("error", (err) => {
                outputChannel.appendLine(`\n❌ Failed to start git-sc: ${err.message}`);
                if (err.message.includes("ENOENT")) {
                    vscode.window
                        .showErrorMessage("git-sc command not found. Please install it and ensure it's in your PATH.", "View Installation")
                        .then((selection) => {
                        if (selection === "View Installation") {
                            vscode.env.openExternal(vscode.Uri.parse("https://github.com/owayo/git-smart-commit#installation"));
                        }
                    });
                }
                else {
                    vscode.window.showErrorMessage(`Failed to run git-sc: ${err.message}`);
                }
                reject(err);
            });
            token.onCancellationRequested(() => {
                process.kill();
                outputChannel.appendLine("\n⚠️ git-sc cancelled by user");
                resolve();
            });
        });
    });
}
//# sourceMappingURL=runGitSc.js.map