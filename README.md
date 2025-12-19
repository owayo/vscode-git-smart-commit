# Git Smart Commit for VS Code

Run [git-sc](https://github.com/owayo/git-smart-commit) command with one click from VS Code.

AI-powered smart commit message generator using coding agents (Gemini CLI, Codex CLI, or Claude Code).

## Features

- **One-Click Commit**: Status bar button to run `git-sc`
- **SCM Integration**: Button in Source Control panel
- **Multiple Modes**:
  - Standard: Interactive commit
  - With Body (-b): Generate detailed commit message
  - Auto Confirm (-y): Skip confirmation prompt
- **Output Channel**: View git-sc output in VS Code

## Prerequisites

Install [git-sc](https://github.com/owayo/git-smart-commit) and ensure it's in your PATH:

```bash
# macOS (Apple Silicon)
curl -L https://github.com/owayo/git-smart-commit/releases/latest/download/git-sc-aarch64-apple-darwin.tar.gz | tar xz
sudo mv git-sc /usr/local/bin/

# macOS (Intel)
curl -L https://github.com/owayo/git-smart-commit/releases/latest/download/git-sc-x86_64-apple-darwin.tar.gz | tar xz
sudo mv git-sc /usr/local/bin/
```

## Usage

### Status Bar Button
Click the `git-sc` button in the status bar.

### Command Palette
- `Git Smart Commit: Stage All & Commit (-a -y)` - Stage all and commit
- `Git Smart Commit: Stage All & Commit with Body (-a -b -y)` - Stage all and commit with body
- `Git Smart Commit: Commit (-y)` - Commit staged changes
- `Git Smart Commit: Commit with Body (-b -y)` - Commit with detailed body
- `Git Smart Commit: Reword Commit` - Select and reword a past commit

### Source Control Panel
Click the ✨ (sparkle) icon in the SCM title bar to open the Git Smart Commit submenu:
- Stage All & Commit (-a -y)
- Stage All & Commit with Body (-a -b -y)
- Commit (-y)
- Commit with Body (-b -y)
- Reword Commit

### Keyboard Shortcuts
| Command | Windows/Linux | macOS |
|---------|---------------|-------|
| Stage All & Commit (-a -y) | `Ctrl+Shift+G C` | `Cmd+Shift+G C` |
| Reword Commit | `Ctrl+Shift+G R` | `Cmd+Shift+G R` |

## Extension Settings

| Setting | Default | Description |
|---------|---------|-------------|
| `gitSmartCommit.autoConfirm` | `false` | Auto confirm commits (-y flag) |
| `gitSmartCommit.includeBody` | `false` | Include body in message (-b flag) |
| `gitSmartCommit.showStatusBarButton` | `true` | Show status bar button |

## Installation

### From VSIX (Manual Install)

```bash
# Package the extension
pnpm run package
# → vscode-git-smart-commit-0.1.0.vsix が生成される

# Install to VS Code
code --install-extension vscode-git-smart-commit-0.1.0.vsix
```

### From Source

```bash
# Clone and install
git clone https://github.com/owayo/vscode-git-smart-commit.git
cd vscode-git-smart-commit
pnpm install
pnpm run compile

# Package and install
pnpm run package
code --install-extension vscode-git-smart-commit-0.1.0.vsix
```

## Development

```bash
# Install dependencies
pnpm install

# Compile
pnpm run compile

# Watch mode
pnpm run watch
```

### Debugging

1. Press `F5` to launch Extension Development Host
2. Make changes to the code
3. Press `Cmd+R` (macOS) / `Ctrl+R` (Windows/Linux) in the Extension Development Host to reload and apply changes

## License

MIT
