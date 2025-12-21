import * as vscode from "vscode";
export interface CommitInfo {
	index: number;
	hash: string;
	message: string;
	date: string;
	author: string;
}
export declare function getRecentCommits(
	workspaceRoot: string,
	limit?: number,
): CommitInfo[];
export declare function rewordCommit(
	outputChannel: vscode.OutputChannel,
): Promise<void>;
//# sourceMappingURL=rewordCommit.d.ts.map
