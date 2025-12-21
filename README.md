<p align="center">
  <img src="icon.png" width="128" alt="Git Smart Commit">
</p>

<h1 align="center">Git-SC (Smart Commit)</h1>

<p align="center">
  AI-powered smart commit message generator for VS Code
</p>

<p align="center">
  <a href="https://marketplace.visualstudio.com/items?itemName=owayo.vscode-git-smart-commit">
    <img alt="VS Marketplace" src="https://img.shields.io/visual-studio-marketplace/v/owayo.vscode-git-smart-commit?label=VS%20Marketplace">
  </a>
  <a href="https://marketplace.visualstudio.com/items?itemName=owayo.vscode-git-smart-commit">
    <img alt="Installs" src="https://img.shields.io/visual-studio-marketplace/i/owayo.vscode-git-smart-commit">
  </a>
  <a href="https://github.com/owayo/vscode-git-smart-commit/actions/workflows/release.yml">
    <img alt="Release" src="https://github.com/owayo/vscode-git-smart-commit/actions/workflows/release.yml/badge.svg">
  </a>
  <a href="LICENSE">
    <img alt="License" src="https://img.shields.io/github/license/owayo/vscode-git-smart-commit">
  </a>
</p>

---

Run [git-sc](https://github.com/owayo/git-smart-commit) command with one click from VS Code. Generate meaningful commit messages using coding agents (Gemini CLI, Codex CLI, or Claude Code).

<!--
## Demo

<p align="center">
  <img src="docs/images/demo.gif" width="600" alt="Demo">
</p>
-->

## Features

- **One-Click Commit** — Status bar button to instantly run `git-sc`
- **SCM Integration** — Submenu in Source Control panel with all commit options
- **Multiple Modes** — Standard, with body (`-b`), auto confirm (`-y`), or combined
- **Reword Commits** — Interactively reword past commit messages
- **Output Channel** — View git-sc output directly in VS Code

## Requirements

Install [git-sc](https://github.com/owayo/git-smart-commit) CLI and ensure it's in your PATH:

```bash
# macOS (Apple Silicon)
curl -L https://github.com/owayo/git-smart-commit/releases/latest/download/git-sc-aarch64-apple-darwin.tar.gz | tar xz
sudo mv git-sc /usr/local/bin/

# macOS (Intel)
curl -L https://github.com/owayo/git-smart-commit/releases/latest/download/git-sc-x86_64-apple-darwin.tar.gz | tar xz
sudo mv git-sc /usr/local/bin/

# Linux (x86_64)
curl -L https://github.com/owayo/git-smart-commit/releases/latest/download/git-sc-x86_64-unknown-linux-gnu.tar.gz | tar xz
sudo mv git-sc /usr/local/bin/
```

## Installation

### From VS Code Marketplace

1. Open VS Code
2. Go to Extensions (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. Search for "Git Smart Commit"
4. Click Install

Or install from command line:

```bash
code --install-extension owayo.vscode-git-smart-commit
```

### From VSIX

Download the latest `.vsix` from [Releases](https://github.com/owayo/vscode-git-smart-commit/releases) and install:

```bash
code --install-extension vscode-git-smart-commit-*.vsix
```

## Usage

### Status Bar

Click the `git-sc` button in the status bar to stage all changes and commit with auto-confirm.

### Source Control Panel

Click the ✨ (sparkle) icon in the SCM title bar to open the submenu:

| Command | Description |
|---------|-------------|
| Stage All & Commit (`-a -y`) | Stage all changes and commit |
| Stage All & Commit with Body (`-a -b -y`) | Stage all and commit with detailed body |
| Commit (`-y`) | Commit staged changes only |
| Commit with Body (`-b -y`) | Commit staged with detailed body |
| Reword Commit | Select and reword a past commit |

### Command Palette

Open Command Palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and type "Git Smart Commit":

- `Git Smart Commit: Stage All & Commit (-a -y)`
- `Git Smart Commit: Stage All & Commit with Body (-a -b -y)`
- `Git Smart Commit: Commit (-y)`
- `Git Smart Commit: Commit with Body (-b -y)`
- `Git Smart Commit: Reword Commit`

### Keyboard Shortcuts

| Command | Windows / Linux | macOS |
|---------|-----------------|-------|
| Stage All & Commit | `Ctrl+Shift+G C` | `Cmd+Shift+G C` |
| Reword Commit | `Ctrl+Shift+G R` | `Cmd+Shift+G R` |

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `gitSmartCommit.autoConfirm` | `false` | Automatically confirm commits without prompting (`-y` flag) |
| `gitSmartCommit.includeBody` | `false` | Generate detailed commit messages with body (`-b` flag) |
| `gitSmartCommit.showStatusBarButton` | `true` | Show git-sc button in status bar |

## Development

```bash
# Clone the repository
git clone https://github.com/owayo/vscode-git-smart-commit.git
cd vscode-git-smart-commit

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
3. Press `Cmd+R` (macOS) / `Ctrl+R` (Windows/Linux) in the Extension Development Host to reload

### Packaging

```bash
pnpm run package
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

[MIT](LICENSE) © owayo
