<p align="center">
  <img src="icon.png" width="128" alt="git-sc">
</p>

<h1 align="center">git-sc (Smart Commit) - VS Code 拡張</h1>

<p align="center">
  AI でコミットメッセージを自動生成する VS Code 拡張機能
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

[git-sc](https://github.com/owayo/git-smart-commit) コマンドを VS Code からワンクリックで実行できる拡張機能です。Gemini CLI、Codex CLI、Claude Code などのコーディングエージェントを使って、意味のあるコミットメッセージを自動生成します。

<!--
## デモ

<p align="center">
  <img src="docs/images/demo.gif" width="600" alt="デモ">
</p>
-->

## 機能

- **ワンクリックコミット** — ステータスバーのボタンで即座に `git-sc` を実行
- **ソース管理パネル統合** — SCM パネルのサブメニューからすべてのコミットオプションにアクセス
- **複数モード対応** — 標準、本文付き (`-b`)、自動確認 (`-y`)、またはその組み合わせ
- **コミットメッセージ書き換え** — 過去のコミットメッセージを対話的に修正
- **出力チャンネル** — git-sc の出力を VS Code 内で直接確認

## 動作要件

[git-sc](https://github.com/owayo/git-smart-commit) CLI をインストールし、PATH に追加してください：

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

## インストール

### VS Code Marketplace から

1. VS Code を開く
2. 拡張機能パネルを開く (`Cmd+Shift+X` / `Ctrl+Shift+X`)
3. "Git Smart Commit" を検索
4. インストールをクリック

または、コマンドラインから：

```bash
code --install-extension owayo.vscode-git-smart-commit
```

### VSIX ファイルから

[Releases](https://github.com/owayo/vscode-git-smart-commit/releases) から最新の `.vsix` をダウンロードしてインストール：

```bash
code --install-extension vscode-git-smart-commit-*.vsix
```

## 使い方

### ステータスバー

ステータスバーの `git-sc` ボタンをクリックすると、すべての変更をステージして自動確認でコミットします。

### ソース管理パネル

SCM タイトルバーの ✨ (スパークル) アイコンをクリックしてサブメニューを開きます：

| コマンド | 説明 |
|---------|------|
| Stage All & Commit (`-a -y`) | すべての変更をステージしてコミット |
| Stage All & Commit with Body (`-a -b -y`) | すべての変更をステージして本文付きでコミット |
| Commit (`-y`) | ステージ済みの変更のみコミット |
| Commit with Body (`-b -y`) | ステージ済みの変更を本文付きでコミット |
| Reword Commit | 過去のコミットメッセージを選択して書き換え |

### コマンドパレット

コマンドパレット (`Cmd+Shift+P` / `Ctrl+Shift+P`) を開いて "Git Smart Commit" と入力：

- `Git Smart Commit: Stage All & Commit (-a -y)`
- `Git Smart Commit: Stage All & Commit with Body (-a -b -y)`
- `Git Smart Commit: Commit (-y)`
- `Git Smart Commit: Commit with Body (-b -y)`
- `Git Smart Commit: Reword Commit`

### キーボードショートカット

| コマンド | Windows / Linux | macOS |
|---------|-----------------|-------|
| すべてステージしてコミット | `Ctrl+Shift+G C` | `Cmd+Shift+G C` |
| コミットメッセージ書き換え | `Ctrl+Shift+G R` | `Cmd+Shift+G R` |

## 設定

| 設定項目 | デフォルト | 説明 |
|---------|-----------|------|
| `gitSmartCommit.autoConfirm` | `false` | 確認プロンプトなしで自動的にコミット (`-y` フラグ) |
| `gitSmartCommit.includeBody` | `false` | 本文付きの詳細なコミットメッセージを生成 (`-b` フラグ) |
| `gitSmartCommit.showStatusBarButton` | `true` | ステータスバーに git-sc ボタンを表示 |

## 開発

```bash
# リポジトリをクローン
git clone https://github.com/owayo/vscode-git-smart-commit.git
cd vscode-git-smart-commit

# 依存関係をインストール
pnpm install

# コンパイル
pnpm run compile

# ウォッチモード
pnpm run watch

# リント
pnpm run lint

# テスト
pnpm run test
```

### デバッグ

1. `F5` を押して Extension Development Host を起動
2. コードを変更
3. Extension Development Host で `Cmd+R` (macOS) / `Ctrl+R` (Windows/Linux) を押してリロード

### リリース

GitHub Actions の「Run workflow」から実行。バージョン更新・ビルド・Marketplace 公開が自動化されています。

## コントリビュート

コントリビュートを歓迎します！Pull Request をお気軽にお送りください。

## ライセンス

[MIT](LICENSE) © owayo
