import { describe, expect, it } from "vitest";
import { isCommandNotFoundError } from "../commands/isCommandNotFoundError";

describe("isCommandNotFoundError", () => {
	it("returns true for POSIX command-not-found exit code", () => {
		expect(isCommandNotFoundError(127, "any error")).toBe(true);
	});

	it("returns true for Windows command-not-found exit code", () => {
		expect(isCommandNotFoundError(9009, "any error")).toBe(true);
	});

	it("returns true for POSIX shell command-not-found message", () => {
		expect(
			isCommandNotFoundError(1, "/bin/sh: git-sc: command not found"),
		).toBe(true);
		expect(isCommandNotFoundError(1, "zsh: command not found: git-sc")).toBe(
			true,
		);
	});

	it("returns true for Windows command-not-found message", () => {
		expect(
			isCommandNotFoundError(
				1,
				"'git-sc' is not recognized as an internal or external command",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				1,
				"The term 'git-sc' is not recognized as the name of a cmdlet",
			),
		).toBe(true);
	});

	it("returns false for unrelated not-found errors", () => {
		expect(isCommandNotFoundError(1, "config file not found")).toBe(false);
		expect(
			isCommandNotFoundError(1, "failed to load git-sc config: file not found"),
		).toBe(false);
	});

	it("returns false for null exit code with unrelated error", () => {
		expect(isCommandNotFoundError(null, "some error")).toBe(false);
	});

	it("returns true for null exit code with command-not-found message", () => {
		expect(isCommandNotFoundError(null, "zsh: command not found: git-sc")).toBe(
			true,
		);
	});

	it("returns false for normal exit codes that are not command-not-found", () => {
		expect(isCommandNotFoundError(0, "")).toBe(false);
		expect(isCommandNotFoundError(1, "generic error")).toBe(false);
		expect(isCommandNotFoundError(2, "fatal: bad revision")).toBe(false);
	});

	it("matches case-insensitively for error messages", () => {
		expect(
			isCommandNotFoundError(
				1,
				"'GIT-SC' IS NOT RECOGNIZED AS AN INTERNAL OR EXTERNAL COMMAND",
			),
		).toBe(true);
		expect(
			isCommandNotFoundError(
				1,
				"THE TERM 'git-sc' IS NOT RECOGNIZED AS THE NAME OF A CMDLET",
			),
		).toBe(true);
	});

	it("returns true for bash-style not found message", () => {
		expect(isCommandNotFoundError(1, "bash: git-sc: command not found")).toBe(
			true,
		);
	});

	it("returns false for empty error message with non-matching exit code", () => {
		expect(isCommandNotFoundError(1, "")).toBe(false);
	});
});
