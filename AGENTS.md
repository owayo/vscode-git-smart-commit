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
    runGitSc.ts             # Core git-sc execution with spawn
    rewordCommit.ts         # Commit reword UI + git log parsing
    isCommandNotFoundError.ts # Cross-platform command-not-found detection
  __tests__/
    extension.test.ts       # Extension activation tests
    isCommandNotFoundError.test.ts # Command-not-found判定のテスト
    rewordCommit.test.ts    # getRecentCommits & rewordCommit tests
    runGitSc.test.ts        # runGitSc command tests
```

### Key Patterns

- Commands are registered in `activate()` and added to `context.subscriptions`
- External process execution uses `child_process.spawn` with shell mode
- Commit history loading for reword uses `execFileSync("git", [...])` with explicit args
- Output is displayed via VS Code `OutputChannel`
- Progress is shown via `vscode.window.withProgress`
- Cancellation is guarded to avoid false error notifications after process kill
- Configuration is read from `vscode.workspace.getConfiguration("gitSmartCommit")`

## Recent Maintenance Notes

- Reword commit parsing now handles subjects containing `|` safely.
- Reword commit history load errors (e.g., missing `git`) now show explicit error messages instead of "No commits found".
- Cancellation flow in both commit and reword commands no longer reports failure on normal cancel.
- Added regression tests for cancellation and reword execution flow.
- Reword execution now uses static `spawn` import for simpler process flow and testability.
- Added tests for `runGitSc` option precedence (`options` overrides workspace configuration).
- Improved command-not-found detection for Windows (`is not recognized`) and added regression tests.
- Fixed off-by-one in reword commit list detail (`0 commit(s) ago` for latest commit) and added regression test.
- Removed legacy ESLint dependencies/config; linting is Biome-only.

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
