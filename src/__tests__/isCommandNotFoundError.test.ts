import { describe, expect, it } from "vitest";
import { isCommandNotFoundError } from "../commands/isCommandNotFoundError";

describe("isCommandNotFoundError", () => {
	it("returns false for unrelated error messages even on exit-code 127 / 9009 scenarios", () => {
		// 本拡張は spawn 前に resolveSpawnCommand で絶対パス解決済みのため、
		// 起動済みプロセスが返す終了コード (POSIX 127 / Windows 9009) は
		// git-sc 自身もしくは内部依存の異常終了とみなす。
		// 未検出判定はメッセージ側のパターン一致時のみ行う。
		expect(isCommandNotFoundError("any error")).toBe(false);
	});

	it("returns true for POSIX shell command-not-found message", () => {
		expect(isCommandNotFoundError("/bin/sh: git-sc: command not found")).toBe(
			true,
		);
		expect(isCommandNotFoundError("zsh: command not found: git-sc")).toBe(true);
	});

	it("returns true for Windows command-not-found message", () => {
		expect(
			isCommandNotFoundError(
				"'git-sc' is not recognized as an internal or external command",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				"The term 'git-sc' is not recognized as the name of a cmdlet",
			),
		).toBe(true);
	});

	it("returns true for Windows message with .cmd / .bat / .exe extensions", () => {
		// cmd.exe / PowerShell は拡張子付きで報告することがある
		expect(
			isCommandNotFoundError(
				"'git-sc.cmd' is not recognized as an internal or external command",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				"'git-sc.bat' is not recognized as an internal or external command",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				"The term 'git-sc.exe' is not recognized as the name of a cmdlet",
			),
		).toBe(true);
	});

	it("returns false for unrelated not-found errors", () => {
		expect(isCommandNotFoundError("config file not found")).toBe(false);
		expect(
			isCommandNotFoundError("failed to load git-sc config: file not found"),
		).toBe(false);
	});

	it("returns false for normal error messages", () => {
		expect(isCommandNotFoundError("")).toBe(false);
		expect(isCommandNotFoundError("generic error")).toBe(false);
		expect(isCommandNotFoundError("fatal: bad revision")).toBe(false);
	});

	it("matches case-insensitively for error messages", () => {
		expect(
			isCommandNotFoundError(
				"'GIT-SC' IS NOT RECOGNIZED AS AN INTERNAL OR EXTERNAL COMMAND",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				"THE TERM 'git-sc' IS NOT RECOGNIZED AS THE NAME OF A CMDLET",
			),
		).toBe(true);
	});

	it("returns true for bash-style not found message", () => {
		expect(isCommandNotFoundError("bash: git-sc: command not found")).toBe(
			true,
		);
	});

	it("returns true for shell not-found message without 'command' prefix", () => {
		expect(isCommandNotFoundError("git-sc: not found")).toBe(true);
	});

	it("returns true for PowerShell message without article 'a'", () => {
		expect(
			isCommandNotFoundError(
				"the term 'git-sc' is not recognized as the name of cmdlet",
			),
		).toBe(true);
	});

	it("returns false for empty error message", () => {
		expect(isCommandNotFoundError("")).toBe(false);
	});

	it("returns true when not-found message appears amid multi-line stderr", () => {
		// 実環境では stderr に複数行のメッセージ（ヘッダや改行）が混じる場合があるため、
		// マッチパターンが行頭・行末に限定されず本文中で検出できることを保証する
		const multiLineStderr = [
			"Some shell warning",
			"bash: git-sc: command not found",
			"Last login: yesterday",
		].join("\n");
		expect(isCommandNotFoundError(multiLineStderr)).toBe(true);
	});

	it("returns true when Windows recognition error is preceded by other output", () => {
		const multiLineStderr = [
			"Microsoft Windows [Version 10.0.0]",
			"(c) Microsoft Corporation. All rights reserved.",
			"'git-sc' is not recognized as an internal or external command,",
			"operable program or batch file.",
		].join("\r\n");
		expect(isCommandNotFoundError(multiLineStderr)).toBe(true);
	});
});
