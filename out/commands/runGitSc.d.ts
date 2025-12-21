import * as vscode from "vscode";
export interface GitScOptions {
	stageAll?: boolean;
	autoConfirm?: boolean;
	includeBody?: boolean;
}
export declare function runGitSc(
	outputChannel: vscode.OutputChannel,
	options?: GitScOptions,
): Promise<void>;
//# sourceMappingURL=runGitSc.d.ts.map
