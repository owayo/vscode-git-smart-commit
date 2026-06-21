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
  <a href="https://open-vsx.org/extension/owayo/vscode-git-smart-commit">
    <img alt="Open VSX" src="https://img.shields.io/open-vsx/v/owayo/vscode-git-smart-commit?label=Open%20VSX">
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
- **複数ルートワークスペース対応** — 開いているフォルダー群から Git 管理下のワークスペースルートを自動で選択
- **実行時環境変数を反映** — Git ルート検出時にその時点の `PATH` など最新の環境変数を使い、古い環境状態を保持しない。`git rev-parse --show-toplevel` の末尾改行だけを除去し、実在するリポジトリパス末尾の空白は保持する
- **キャンセル時の安定動作** — 実行キャンセル時に不要な失敗通知を表示しない。POSIX では `detached: true` で `git-sc` をプロセスグループのリーダーとして起動し、`process.kill(-pid, "SIGTERM")` でグループ全体に SIGTERM を送ることで `git-sc` が起動した `git` 等の孫プロセスもまとめて終了させる (グループ kill 失敗時は単体 PID にフォールバック)。SIGTERM を無視するプロセスに備え、5 秒経過しても `close` が来ない場合は SIGKILL に昇格してプロセスグループを強制終了する。Windows では `SystemRoot\\System32\\taskkill.exe` または安全に解決した native `taskkill` を絶対パスで起動し、`/T /F` でプロセスツリー全体を終了させる (`taskkill /F` 自体が強制終了相当のため、Windows 側に追加の SIGKILL 昇格は不要)。さらにキャンセル時はプロセスの `close` イベントを待ってから完了扱いにするため、終了未確定のまま VS Code に成功通知が出て裏でバックグラウンド処理が続く心配がない。`close` / `error` で成功・失敗が確定した後にキャンセル通知が遅れて到着するレースでも、終了済みプロセスに再 kill や SIGKILL タイマーを仕掛けず、誤った「キャンセル」ログも出力しない。Windows で `taskkill` の解決・起動・終了に失敗した場合も、拡張機能を落とさず出力チャンネルへ警告を記録し、直接の子プロセスへ `SIGTERM` をフォールバック送信する。加えて、VS Code の reload / 終了 / 拡張停止 (`deactivate`) 時には実行中の `git-sc` とその子孫プロセスをまとめて終了し、特に POSIX で `detached` 起動したプロセスが孤児として残らないようにする
- **履歴解析の堅牢化** — `Reword Commit` で `|`、`\x1f`、`\x1e` を含む件名も NUL 区切り解析で正しく扱える。`format:` プレフィックスと改行セパレータ除去により、複数コミット間のハッシュ汚染を防止
- **履歴状態に応じた案内** — 空リポジトリでは「コミットなし」を警告表示し、`git` 未導入や不正な作業ツリーでは原因を明示して通知
- **未導入検知の強化** — Windows の `is not recognized` を含むエラーでもインストール案内を表示し、そのまま GitHub の導入手順を開ける。導入手順 URL のオープンが失敗しても (Promise の reject、および VS Code が「オープン失敗」を示す `false` を返した場合のいずれも)、未処理 Promise rejection にせず出力チャンネルに警告を記録する。さらに POSIX で `spawn` が `ENOENT` になった際に Node.js が `error` と `close` を連続発火しても、インストール案内ダイアログや失敗通知が重複しないように `settled` フラグで抑止する
- **実行ファイル解決の安全化** — `git-sc` は `PATH` の完全修飾された絶対パス要素のみから通常ファイルとして解決し、空要素・`.`・相対 PATH 要素 (`bin`、`.\tools` 等)・Windows の drive-relative パス (`\tools` 等。`path.win32.isAbsolute` では絶対扱いだが current drive 依存) や同名ディレクトリを完全に除外する。Windows の `CreateProcess` がカレントディレクトリを探索パスに含める挙動に加え、POSIX でも `PATH` に空要素や `.` が含まれる場合に悪意あるリポジトリ直下の `git-sc` を拾うリスクを防ぐ。Windows の `.cmd`/`.bat` は `shell: true` ではなく `SystemRoot\\System32\\cmd.exe` を絶対パスで解決し、`windowsVerbatimArguments: true` + CommandLineToArgvW 互換の自前 quote で起動することで、Node.js DEP0190 (`shell: true` + `args` の unsafe な空白連結) と空白入り PATH / cmd.exe メタ文字を含む引数による shell injection の双方を回避する。さらに cmd.exe が二重引用符の内側でも `%VAR%` を展開する挙動に備え、`%` を含む引数・実行ファイルパスは拒否して誤実行を防ぐ。同様に `git` CLI 呼び出しも安全に解決した native 実行ファイルの絶対パスを使い、作業ディレクトリは `-C <dir>` 引数で渡す。native 実行ファイル解決では `.exe`/`.com` のみを許可し、直接指定された `.cmd`/`.bat` は返さない。Windows で拡張子付きコマンド名が渡された場合も、`PATHEXT` を連結した別ファイルではなく指定名そのものだけを確認する
- **Git 拡張連携の堅牢化** — コミット成功後の `git.refresh` 呼び出しが Git 拡張無効化等で reject しても、未処理 Promise rejection で拡張機能が落ちない。失敗は出力チャンネルに警告として記録される

## 動作要件

VS Code `1.120.0` 以上が必要です。

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

コマンド実行時に引数を明示した場合は、その値がワークスペース設定より優先されます。

複数ルートワークスペースでは、開いているフォルダーを順に確認し、最初に見つかった Git リポジトリのルートで `git-sc` と履歴読み込みを実行します。

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

# フォーマット
pnpm run format

# テスト
pnpm run test

# 依存脆弱性チェック
pnpm audit --audit-level moderate
```

dev 依存の推移依存には `pnpm-workspace.yaml` の `overrides` と lockfile 更新でパッチ済みバージョンを明示し、`pnpm audit --audit-level moderate` が通る状態を維持します。`@vscode/vsce` / `ovsx` / `vitest` 経由の `esbuild`、`tmp`、`form-data`、`vite`、`js-yaml`、`markdown-it` も patched version へ固定し、`tmp` は path traversal 脆弱性が修正された `0.2.7` 以上へ上げています。pnpm 11 の install script 承認は `allowBuilds` で `@vscode/vsce-sign`、`esbuild`、`keytar` を明示し、`pnpm install --frozen-lockfile` が非対話環境でも完了するようにします。

ユニットテストには、`extension.ts` で登録される各コマンドハンドラのオプション引き渡し、内部コマンド失敗時の例外抑止、キャンセル時の POSIX `SIGTERM` と Windows `taskkill` 分岐、`taskkill` 失敗時の `SIGTERM` フォールバック、`PATH` の空要素・相対要素・同名ディレクトリを除外する実行ファイル解決、POSIX で `PATH` 環境変数自体が未定義のときに null を返す安全側の境界、Windows の `Path` / 小文字 `path` 環境変数フォールバック、安全な native `git` 解決、直接指定された `.CMD` を native 実行ファイルとして返さない境界値、拡張子付きコマンド名へ `PATHEXT` を連結しない回帰ケース、`.cmd` / `.bat` 起動時に cmd.exe メタ文字を含む引数を個別 quote する回帰ケース、引数内のダブルクォート・末尾バックスラッシュ・ダブルクォート直前のバックスラッシュ (`a\"b` を `2n+1` 個へ拡張) を CommandLineToArgvW 互換でエスケープする回帰ケース、`taskkill` の絶対パス解決と `WINDIR` / 小文字 `systemroot` / 小文字 `windir` フォールバック、System32 配下の同名ディレクトリ拒否、Git ルートパス末尾の空白保持、Windows の drive-relative な PATH 要素・SystemRoot の除外と UNC パス要素の受け入れ、cmd.exe の `%VAR%` 展開を防ぐ `%` を含む引数・実行ファイルパスの拒否、`deactivate` 時に実行中の `git-sc` を終了させる回帰ケース、導入手順リンクのオープン失敗時 (Promise の reject および VS Code が返す `false` 解決) に警告ログへ落とし、`true` 解決時には警告を出さない回帰ケース、security override が削除・退行しないことを確認する `pnpm-workspace.yaml` 退行ケース、失敗ログに関する回帰ケースも含まれます。

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
