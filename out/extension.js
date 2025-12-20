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
exports.activate = activate;
exports.deactivate = deactivate;
const vscode = __importStar(require("vscode"));
const runGitSc_1 = require("./commands/runGitSc");
const rewordCommit_1 = require("./commands/rewordCommit");
let statusBarItem;
let outputChannel;
function activate(context) {
    outputChannel = vscode.window.createOutputChannel("Git Smart Commit");
    // Register commands
    // -a -y
    const runAddAutoConfirmCommand = vscode.commands.registerCommand("git-smart-commit.runAddAutoConfirm", async () => {
        try {
            await (0, runGitSc_1.runGitSc)(outputChannel, { stageAll: true, autoConfirm: true });
        }
        catch {
            // Error already handled in runGitSc
        }
    });
    // -a -b -y
    const runAddBodyAutoConfirmCommand = vscode.commands.registerCommand("git-smart-commit.runAddBodyAutoConfirm", async () => {
        try {
            await (0, runGitSc_1.runGitSc)(outputChannel, {
                stageAll: true,
                includeBody: true,
                autoConfirm: true,
            });
        }
        catch {
            // Error already handled in runGitSc
        }
    });
    // -y
    const runAutoConfirmCommand = vscode.commands.registerCommand("git-smart-commit.runAutoConfirm", async () => {
        try {
            await (0, runGitSc_1.runGitSc)(outputChannel, { autoConfirm: true });
        }
        catch {
            // Error already handled in runGitSc
        }
    });
    // -b -y
    const runBodyAutoConfirmCommand = vscode.commands.registerCommand("git-smart-commit.runBodyAutoConfirm", async () => {
        try {
            await (0, runGitSc_1.runGitSc)(outputChannel, { includeBody: true, autoConfirm: true });
        }
        catch {
            // Error already handled in runGitSc
        }
    });
    // Reword (QuickPick selection)
    const rewordCommand = vscode.commands.registerCommand("git-smart-commit.reword", async () => {
        try {
            await (0, rewordCommit_1.rewordCommit)(outputChannel);
        }
        catch {
            // Error already handled in rewordCommit
        }
    });
    context.subscriptions.push(runAddAutoConfirmCommand, runAddBodyAutoConfirmCommand, runAutoConfirmCommand, runBodyAutoConfirmCommand, rewordCommand);
    // Create status bar item
    createStatusBarItem(context);
    // Watch for configuration changes
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
        if (e.affectsConfiguration("gitSmartCommit.showStatusBarButton")) {
            updateStatusBarVisibility();
        }
    }));
    outputChannel.appendLine("Git Smart Commit extension activated");
}
function createStatusBarItem(context) {
    statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    statusBarItem.command = "git-smart-commit.runAddAutoConfirm";
    statusBarItem.text = "$(sparkle) git-sc";
    statusBarItem.tooltip = "Git Smart Commit (-a -y)";
    context.subscriptions.push(statusBarItem);
    updateStatusBarVisibility();
}
function updateStatusBarVisibility() {
    if (!statusBarItem) {
        return;
    }
    const config = vscode.workspace.getConfiguration("gitSmartCommit");
    const showButton = config.get("showStatusBarButton", true);
    if (showButton) {
        statusBarItem.show();
    }
    else {
        statusBarItem.hide();
    }
}
function deactivate() {
    outputChannel?.dispose();
}
//# sourceMappingURL=extension.js.map