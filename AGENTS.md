# vscode-git-smart-commit

VS Code extension for running git-sc (AI-powered smart commit message generator).

## Project Overview

- **Type**: VS Code Extension (TypeScript)
- **Package Manager**: pnpm
- **Build System**: TypeScript compiler (`tsc`)
- **Test Framework**: Vitest (`vitest run`)
- **Linter**: Biome (`biome.jsonc`)
- **Entry Point**: `src/extension.ts` -> `dist/extension.js`

## Commands

```bash
# Install dependencies
pnpm install

# Compile
pnpm run compile

# Watch mode
pnpm run watch

# Lint
pnpm run lint

# Format
pnpm run format

# Test
pnpm run test

# Package VSIX
pnpm exec vsce package --no-dependencies
```

## Architecture

```
src/
  extension.ts              # Extension entry point (activate/deactivate)
  commands/
    getGitWorkspaceRoot.ts  # Resolve the first Git repository root from open workspace folders
    runGitSc.ts             # Core git-sc execution with spawn
    rewordCommit.ts         # Commit reword UI + git log parsing
    isCommandNotFoundError.ts # Cross-platform command-not-found detection
    terminateProcessForCancellation.ts # Safe cancellation helper for POSIX and Windows
  __tests__/
    extension.test.ts       # Extension activation tests
    getGitWorkspaceRoot.test.ts # Git workspace root resolution tests
    isCommandNotFoundError.test.ts # Command-not-found判定のテスト
    rewordCommit.test.ts    # getRecentCommits & rewordCommit tests
    runGitSc.test.ts        # runGitSc command tests
```

### Key Patterns

- Commands are registered in `activate()` and added to `context.subscriptions`
- External process execution uses `child_process.spawn`. POSIX environments use `shell: false` so `process.kill("SIGTERM")` reaches the real `git-sc` child directly. Windows uses `shell: true` (required for `.cmd` after Node.js CVE-2024-27980 hardening) and cancels via `taskkill /PID <pid> /T /F` to terminate the whole process tree.
- Commit history loading for reword uses `execFileSync("git", [...])` with explicit args
- Commands resolve the first reachable Git repository root across open workspace folders before running `git-sc` or `git log`
- Output is displayed via VS Code `OutputChannel`
- Progress is shown via `vscode.window.withProgress`
- Cancellation is guarded to avoid false error notifications after process kill
- Configuration is read from `vscode.workspace.getConfiguration("gitSmartCommit")`

## Recent Maintenance Notes

- Windows cancellation now guards `taskkill` startup failures so a failed helper spawn is logged to the output channel instead of surfacing as an unhandled `error` event.
- Added regression tests for `taskkill` spawn errors during Windows cancellation in both commit and reword flows.
- @vscode/vsce updated to 3.9.1.
- Vitest updated to 4.1.5.
- Reword commit parsing now uses NUL-delimited `git log` output so subjects containing record separators (`\x1e`) are preserved correctly.
- Reword commit parsing now handles subjects containing `|` safely.
- Reword commit parsing now preserves subjects containing field separators (`\x1f`) without shifting `date`/`author`.
- Reword commit history load errors (e.g., missing `git`) now show explicit error messages instead of "No commits found".
- Reword Commit now shows a warning instead of an error when the repository has no commits yet, using `git rev-list --count --all` to distinguish empty history from actual failures.
- Added regression tests to ensure the empty-history fallback does not hide the original `git log` error when the secondary `git rev-list --count --all` probe also fails.
- Cancellation flow in both commit and reword commands no longer reports failure on normal cancel.
- Added regression tests for cancellation and reword execution flow.
- Reword execution now uses static `spawn` import for simpler process flow and testability.
- Added tests for `runGitSc` option precedence (`options` overrides workspace configuration).
- Improved command-not-found detection for Windows (`is not recognized`) and added regression tests.
- Fixed off-by-one in reword commit list detail (`0 commit(s) ago` for latest commit) and added regression test.
- Removed legacy ESLint dependencies/config; linting is Biome-only.
- Added tests for empty stderr/stdout fallback message, stderr capture, reword non-ENOENT spawn error, and pre-activation deactivate safety.
- Added edge-case tests for empty workspace folders array (`[]`) in both `runGitSc` and `rewordCommit`.
- Added `isCommandNotFoundError` tests for shell `not found` pattern (without "command" prefix) and PowerShell pattern without article "a".
- Added edge-case tests for cancellation followed by `close`/`error` events in both `runGitSc` and `rewordCommit`.
- Added test for reword fallback exit code message when stderr/stdout are empty.
- Fixed git log format to use `format:` prefix (`--format=format:...`) instead of default `tformat:` semantics to prevent terminator newlines from contaminating commit hashes in multi-commit parsing.
- Added regression test for tformat newline contamination and format prefix verification.
- Biome updated to 2.4.10.
- Vitest updated to 4.1.2.
- Added edge-case tests for confirmation dialog escape-cancel, `getCommitCount` non-numeric output, and `getCommitCount` returning positive count on git log failure.
- Added Git workspace root resolution for multi-root workspaces so commands no longer fail when the first folder is outside a repository.
- Added regression tests for Git workspace root resolution in both direct unit tests and command flows.
- Fixed hash field corruption from `format:` newline separators in multi-commit parsing — 2nd+ commit hashes had a leading `\n` which broke `git-sc --reword`. Applied targeted `replace(/^\n/, "")` instead of broad `trim()`.
- Added tests for 3+ commits with `format:` newline separators, single commit parsing, and `getGitWorkspaceRoot` single folder / empty string edge cases.
- Added regression tests that verify the "View Installation" action actually opens the installation guide in both commit and reword failure flows.
- Added test for `getGitWorkspaceRoot` with empty array input.
- Added test for `runGitSc` stdout fallback when stderr is empty on failure.
- Added test for `rewordCommit` close event firing after cancellation.
- Fixed `getGitWorkspaceRoot` to distinguish "not a git repository" errors from other failures (ENOENT, permission errors). Previously all `execFileSync` exceptions were silently swallowed, causing misleading "No Git repository found" messages when git was not installed or access was denied.
- Added error handling in `runGitSc` and `rewordCommit` callers to show appropriate messages for git-not-found vs generic git errors from workspace root detection.
- Added regression tests for ENOENT, permission error, and mixed error scenarios in `getGitWorkspaceRoot`, `runGitSc`, and `rewordCommit`.
- Added test for config change callback no-op when unrelated configuration key changes.
- Added tests for explicit `stageAll: false` and `includeBody: false` verifying flags are excluded.
- Added tests for reword stdout/stderr capture and `rewordCommit` calling `getRecentCommits` with limit=15.
- @types/node updated to 25.5.2.
- Added test for reword stdout fallback when stderr is empty on failure.
- Added test for `FORCE_COLOR=0` env in reword process spawn.
- Added test for case-insensitive "not a git repository" matching in `getGitWorkspaceRoot`.
- Added tests for status bar item properties (command, text, tooltip) and activation log message.
- Added tests for chunked stdout/stderr data accumulation in `runGitSc`.
- Added tests for incomplete/partial field handling in `getRecentCommits` parsing.
- Added test for installation dialog dismissal (openExternal not called when user dismisses) in both `runGitSc` and `rewordCommit`.
- Added test for `progress.report` message content verification in both `runGitSc` and `rewordCommit`.
- Added test for `getRecentCommits` `Infinity` limit fallback to default.
- Vitest updated to 4.1.3.
- Added test for `deactivate()` calling `outputChannel.dispose()`.
- Added test for registered command handlers count and names verification.
- Added test for command handler error suppression (catch block).
- Added `isCommandNotFoundError` tests for combined exit code + message match and exit code only with empty message.
- Added test for `runGitSc` with `stageAll: undefined` verifying `-a` flag is excluded.
- Fixed `getGitWorkspaceRoot` to set `LC_ALL=C` and `LANG=C` when invoking git, so that localized (e.g., Japanese) error messages do not break the "not a git repository" detection in multi-root workspaces.
- Added test for `LC_ALL=C` / `LANG=C` env verification in `getGitWorkspaceRoot`.
- Added tests for error message truncation at 100 characters in both `runGitSc` and `rewordCommit`.
- Added test for QuickPick `matchOnDescription` and `matchOnDetail` options in `rewordCommit`.
- Added test for QuickPick item label format (git-commit icon prefix) and description format in `rewordCommit`.
- Added test for `getGitWorkspaceRoot` error message truncation at 100 characters in `rewordCommit`.
- Vitest updated to 4.1.4.
- Biome updated to 2.4.11.
- Fixed `getGitWorkspaceRoot` to build the Git locale environment per call so runtime `PATH` and other environment updates are not lost after module import.
- Added regression test verifying `getGitWorkspaceRoot` passes environment variables added after module import.
- Added tests for `outputChannel.show(true)` call and header/status marker lines (`✅`/`❌`/`⚠️`) in both `runGitSc` and `rewordCommit`.
- Added tests for `withProgress` options verification (location, title, cancellable) in `runGitSc`.
- Added negative assertion tests for `git.refresh` not being called on failure in both `runGitSc` and `rewordCommit`.
- Added tests for spawn error marker output to `outputChannel` in `runGitSc`.
- Added tests for confirmation QuickPick items (`["Yes", "No"]`) and title (`"Confirm Reword"`) verification in `rewordCommit`.
- Added tests for commit selection QuickPick `placeHolder` and `title` verification in `rewordCommit`.
- Added test for chunked stderr accumulation in `rewordCommit` reword flow.
- Added test for `createStatusBarItem` alignment (`Left`) and priority (`100`) in extension activation.
- Added test for all 5 command handler invocations without error in extension activation.
- Added test for multi-folder workspace where first folder returns empty string in `getGitWorkspaceRoot`.
- @types/node updated to 25.6.0.
- Added test for status bar visibility toggle on repeated config changes in extension activation.
- Added test for null exit code (signal kill) without cancellation in both `runGitSc` and `rewordCommit`.
- Added test for working directory in header output of `runGitSc`.
- Added tests for reword header lines output and `withProgress` options verification in `rewordCommit`.
- Added test for spawn error marker output to `outputChannel` in `rewordCommit`.
- Added extension command handler regression tests that verify each command dispatches the expected options and still swallows rejected `runGitSc` / `rewordCommit` calls.
- Biome updated to 2.4.12.
- @vscode/vsce updated to 3.9.0.
- ovsx updated to 0.10.11.
- typescript updated to 6.0.3.
- Fixed cancellation regression where `spawn("git-sc", ..., { shell: true })` followed by `process.kill()` only terminated the relay shell, leaving `git-sc` running after the user cancelled. Now POSIX uses `shell: false` + `process.kill("SIGTERM")` and Windows uses `shell: true` + `taskkill /PID <pid> /T /F` so the entire process tree exits. `windowsHide: true` is set to prevent flashing console windows on Windows.
- Added regression tests for the platform-aware spawn options (`shell` flag), `taskkill` invocation on Windows cancellation, and `SIGTERM` delivery on POSIX cancellation in both commit and reword flows.

## VS Code Extension Details

- **Activation**: `workspaceContains:.git`
- **Engine**: `vscode ^1.96.0`
- **Publisher**: owayo
- **Commands**: 5 commands (4 commit variants + reword)
- **Keybindings**: `Cmd+Shift+G C` (commit), `Cmd+Shift+G R` (reword)

## CI/CD

- GitHub Actions workflow: `.github/workflows/release.yml`
- Triggered manually via `workflow_dispatch`
- CalVer versioning: `YY.M.COUNTER` (e.g., 25.12.110)
- Publishes to VS Code Marketplace and Open VSX Registry

## Development Rules

- Do not commit/push manually (git-sc hook handles it)
- Use `safe-rm` instead of `rm` for file deletion
- Use `safe-kill` instead of `kill` for process termination
