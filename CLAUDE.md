# vscode-git-smart-commit

VS Code extension for running git-sc (AI-powered smart commit message generator).

## Project Overview

- **Type**: VS Code Extension (TypeScript)
- **Package Manager**: pnpm
- **Build System**: TypeScript compiler (`tsc`)
- **Test Framework**: Vitest (`vitest run`)
- **Linter**: ESLint (flat config: `eslint.config.mjs`)
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
    rewordCommit.ts         # Commit reword via QuickPick UI
  __tests__/
    extension.test.ts       # Extension activation tests
    rewordCommit.test.ts    # getRecentCommits & rewordCommit tests
    runGitSc.test.ts        # runGitSc command tests
```

### Key Patterns

- Commands are registered in `activate()` and added to `context.subscriptions`
- External process execution uses `child_process.spawn` with shell mode
- Output is displayed via VS Code `OutputChannel`
- Progress is shown via `vscode.window.withProgress`
- Configuration is read from `vscode.workspace.getConfiguration("gitSmartCommit")`

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
- Publishes to VS Code Marketplace

## Development Rules

- Do not commit/push manually (git-sc hook handles it)
- Use `safe-rm` instead of `rm` for file deletion
- Use `safe-kill` instead of `kill` for process termination
