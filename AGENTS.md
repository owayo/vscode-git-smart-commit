# vscode-git-smart-commit

git-sc (AI によるスマートコミットメッセージ生成) を VS Code から実行する拡張機能。

## プロジェクト概要

- **種別**: VS Code Extension (TypeScript)
- **パッケージマネージャ**: pnpm
- **ビルドシステム**: TypeScript compiler (`tsc`)
- **テストフレームワーク**: Vitest (`vitest run`)
- **Linter**: Biome (`biome.jsonc`)
- **pnpm 設定**: `pnpm-workspace.yaml` (patched transitive dependency 用 `overrides`、承認済み install script 用 `allowBuilds`)
- **エントリポイント**: `src/extension.ts` -> `dist/extension.js`

## コマンド

```bash
# 依存関係をインストール
pnpm install

# コンパイル
pnpm run compile

# ウォッチモード
pnpm run watch

# Lint
pnpm run lint

# Format
pnpm run format

# Test
pnpm run test

# VSIX パッケージ作成
pnpm exec vsce package --no-dependencies
```

## アーキテクチャ

```
src/
  extension.ts              # 拡張機能エントリポイント (activate/deactivate)
  commands/
    getGitWorkspaceRoot.ts  # 開いている workspace folders から最初の Git repository root を解決
    runGitSc.ts             # commit フローのオプション組み立て + 共通 spawn ヘルパー呼び出し
    rewordCommit.ts         # Commit reword UI + git log parsing + 共通 spawn ヘルパー呼び出し
    spawnGitScProcess.ts    # commit / reword 共通の git-sc spawn + 進捗 + キャンセル状態機械
    isCommandNotFoundError.ts # platform 横断の command-not-found 判定
    terminateProcessForCancellation.ts # POSIX / Windows の安全なキャンセル補助
    resolveExecutablePath.ts # PATH 走査による実行ファイル絶対パス解決 (cwd ハイジャック対策)
  __tests__/
    dependencyOverrides.test.ts # pnpm override と package metadata の退行テスト
    extension.test.ts       # 拡張機能 activation のテスト
    getGitWorkspaceRoot.test.ts # Git workspace root 解決テスト
    isCommandNotFoundError.test.ts # Command-not-found判定のテスト
    rewordCommit.test.ts    # getRecentCommits & rewordCommit tests
    runGitSc.test.ts        # runGitSc command tests
    terminateProcessForCancellation.test.ts # キャンセル補助のテスト
    resolveExecutablePath.test.ts # PATH 解決ロジックのユニットテスト
```

### 主要パターン

- Commands は `activate()` で登録し、`context.subscriptions` に追加する
- `git-sc` の spawn / `withProgress` 進捗表示 / キャンセル状態機械は commit フロー (`runGitSc`) と reword フロー (`runGitScReword`) で完全に同一のため、`spawnGitScProcess.ts` の `spawnGitScWithProgress({ outputChannel, workspaceRoot, args, messages })` に集約している。呼び出し側は引数とフロー固有の表示文言 (`messages`) だけを渡す。`showGitScNotFoundMessage` / `GIT_SC_INSTALLATION_URL` もこのヘルパー内に定義する。
- External process execution uses `child_process.spawn` with **`shell: false` を全 platform で固定**。`git-sc` は `resolveSpawnCommand(name, args)` で絶対パスに解決した上で起動する。PATH 走査は完全修飾された絶対パス要素 (Windows は drive-qualified `C:\` / UNC `\\` のみ。`\foo` のような drive-relative パスは current drive 依存のため除外) だけを許容し、空要素・`.`・相対パスも全て除外することで cwd ハイジャック (悪意ある repo 直下や別ドライブの `git-sc` / `git-sc.cmd` 優先実行) を防ぐ。Windows の `PATHEXT` は `.EXE` のような純粋な拡張子だけを採用し、パス区切りやドライブ区切りを含む壊れた要素は探索候補から除外することで、`path.win32.join` の正規化により候補パスが PATH 要素の外へずれるのを防ぐ。
  - **POSIX**: `detached: true` で起動し子プロセスがプロセスグループのリーダーになる。キャンセル時は `process.kill(-pid, "SIGTERM")` でプロセスグループ全体へ送信し、`git-sc` が起動した `git` 等の孫プロセスもまとめて終了させる。`process.kill(-pid)` が失敗した場合は直接の子プロセスへ `SIGTERM` をフォールバック送信する。SIGTERM を `trap "" TERM` 等で無視するプロセスに備え、5 秒経過しても `close` が来ない場合は SIGKILL に昇格してプロセスグループを強制終了する。`close` / `error` 到着時は `forceKillTimer` をクリアして余計な SIGKILL を送らない。
  - **Windows `.exe` 等**: 絶対パスを `shell: false` で直接起動する。
  - **Windows `.cmd` / `.bat`**: CreateProcess で直接起動できないため、`SystemRoot\System32\cmd.exe` を絶対パスで解決し、各引数を CommandLineToArgvW 互換で自前 quote した上で `["/d", "/s", "/c", "\"resolved\" \"arg1\" ..."]` を `windowsVerbatimArguments: true` で渡す。これにより Node.js DEP0190 (`shell: true` + `args` の unsafe な空白連結による shell injection) と、空白入りパス / cmd.exe メタ文字を含む引数による injection の双方を回避する。なお cmd.exe は二重引用符の内側でも `%VAR%` を環境変数展開し `%` を確実にエスケープする手段がないため、`%` を含む引数・実行ファイルパスは `escapeCmdArgument` で拒否して誤実行を防ぐ。また cmd.exe は CommandLineToArgvW と異なり `\"` を `"` のエスケープとして解釈せず string トグルとして扱い、引用が途中で閉じて後続の `&` `|` `<` `>` `^` が露出するため、`"` を含む引数・実行ファイルパスも `escapeCmdArgument` で拒否する。キャンセル時は `SystemRoot\System32\taskkill.exe` または安全に解決した native `taskkill` を絶対パスで起動し、`/PID <pid> /T /F` でプロセスツリーごと終了させる。`taskkill` の解決・起動・終了に失敗した場合は直接の子プロセスへ `SIGTERM` をフォールバック送信する。
  - PATH 上に安全な絶対パスが見つからない場合・Windows で cmd.exe を解決できない場合は、フォールバック spawn せずインストール案内へ誘導する。
- Cancellation はキャンセルハンドラ内で `resolveOnce()` を呼ばず、`close` イベントでプロセス (および POSIX ではプロセスグループ) の終了を確認してから resolve する。これにより、キャンセル直後に終了未確定のまま VS Code 上で成功扱いになり、`git-sc` の子孫プロセスが裏で走り続ける事象を防ぐ。
- 実行中の `git-sc` 子プロセスは `spawnGitScProcess.ts` の module-level `Map<ChildProcess, () => void>` で「プロセス → 終了ハンドラ」を追跡し (spawn 後に登録、`close`/`error` で delete)、拡張機能の `deactivate()` から `terminateActiveGitScProcesses(outputChannel)` を呼んで一括終了する。これにより VS Code の reload / 終了 / 拡張停止時に、POSIX で `detached` 起動した `git-sc` とその子孫が孤児として残らないようにする。終了ハンドラは `isCancelled` を立ててから SIGTERM (Windows は `taskkill /T /F`) で終了させるため、拡張停止に伴う `close` が「キャンセル」扱いになり、誤った成功/失敗通知や `git.refresh` を出さない。
- Git CLI 呼び出しは `resolveNativeExecutableOnPath("git")` で `.exe`/`.com` 等の native 実行ファイルを絶対パスに解決してから `execFileSync(<gitPath>, ["-C", <dir>, ...])` で実行する。bare command と `cwd: <dir>` を使わないことで、Windows の `CreateProcess` がカレントディレクトリを実行ファイル探索パスに含める cwd ハイジャックを回避する。`git rev-parse --show-toplevel` の出力は Git が付与する末尾改行だけを除去し、実在するリポジトリパス末尾の空白は保持する。
- Commands は `git-sc` / `git log` を実行する前に、開いている workspace folders から最初に到達可能な Git repository root を解決する
- Output is displayed via VS Code `OutputChannel`; `git-sc` の stdout/stderr は `setEncoding("utf8")` で UTF-8 ストリームとしてデコードし、日本語などの複数バイト文字がチャンク境界で分割されても `�` に置換されないようにする。
- Progress は `vscode.window.withProgress` で表示する
- Cancellation は process kill 後の誤った error notification を避けるようガードする
- Configuration は `vscode.workspace.getConfiguration("gitSmartCommit")` から読む
- `vscode.commands.executeCommand("git.refresh")` の戻り値（Thenable）は `Promise.resolve(...).catch(...)` で囲み、Git 拡張が無効化されている等で reject した場合に未処理 rejection にせず `OutputChannel` に警告を記録する。
- インストール案内ダイアログの "View Installation" から `vscode.env.openExternal(...)` を呼ぶ経路も `Promise.resolve(...).catch(...)` で囲み、URL オープン失敗時は未処理 rejection にせず `OutputChannel` に警告を記録する。

## Recent Maintenance Notes

- `depup --install --include-pinned` は更新なし、`biome migrate --write` は no-op、`pnpm audit --audit-level moderate` は `No known vulnerabilities found` を維持。コードベース全体を再レビューし、確実な実装バグとして修正すべき箇所は見つからなかった一方、`pnpm-workspace.yaml` の security override が `dependencyOverrides.test.ts` で一部しか固定されていなかったため、現在の audit clean 状態を支える override 全体を退行テストで固定した。あわせて workflow 内の英語コメントを日本語化した。`pnpm run lint` / `pnpm run test` (291 tests) / `pnpm run compile` / `pnpm exec vsce package --no-dependencies` は成功し、CodeRabbit CLI (`coderabbit review --agent --type uncommitted`) は findings 0、`astro-sight review --dir . --git` も unresolved impact / missing cochange / API diff / dead symbols なし。
- @types/node updated to 26.0.1 (patch). 型定義のみの patch 更新でメジャー更新は無く、`biome migrate --write` は no-op、`pnpm audit --audit-level moderate` は `No known vulnerabilities found` を維持。あわせて Gemini 3.1 Pro (High) のセカンドオピニオンでコードベース全体をクロスチェックし、確実なバグとして `spawnGitScWithProgress` の stdout/stderr `Buffer.toString()` 直変換が UTF-8 複数バイト文字の途中でチャンク分割された場合に U+FFFD へ置換して復元不能な文字化けを起こす点を採用修正した。`process.stdout.setEncoding("utf8")` / `process.stderr.setEncoding("utf8")` を設定して Node の StringDecoder に境界保持させ、stdout/stderr それぞれで `"あ"` の UTF-8 バイト列を分割投入しても `�` を含まず正しく出力される回帰テストを追加した (総テスト 291 件)。CodeRabbit CLI (`coderabbit review --agent --type uncommitted`) は指摘 0 件、`astro-sight review --dir . --git` も unresolved impact / missing cochange / API diff / dead symbols なし。
- Added regression tests for v8 カバレッジ計測により判明した「到達可能だが未カバーだった 5 つの実挙動」。(1) `resolveExecutableOnPath` の Windows で拡張子なし名が `PATHEXT` の全拡張子付き候補 (`git-sc.EXE` 等) に一致せず、拡張子なしの bare 名の実体へフォールバックする分岐 (`resolveExecutablePath.ts:170`)、(2) `resolveNativeExecutableOnPath` が POSIX では `resolveExecutableOnPath` へ委譲する分岐 (同 `:185`)、(3) `resolveWindowsSystemExecutable` が非 Windows では解決を試みず即 `null` を返す分岐 (同 `:227`)、(4) ユーザーキャンセル直後 (`isCancelled=true` かつ `close` 未達で active map に残存) に deactivate 相当の `terminateActiveGitScProcesses` が走っても shutdown ハンドラが `if (isCancelled || settled) return` で早期 return し、`terminateProcessForCancellation` を再実行してプロセスを二重終了しない race (`spawnGitScProcess.ts:220`)、(5) 正常 `close(0)` で `settled` になった後に遅延 `error` イベントが発火しても、error ハンドラが `settled` ガードで早期 return し、成功通知の後に失敗通知/`Failed to start git-sc` ログを二重に出さない race (同 `:292`)。いずれも security-sensitive な PATH 絶対パス解決とキャンセル状態機械の実挙動で、退行するとそれぞれ Windows の実行ファイル探索・cwd ハイジャック対策・二重終了/二重通知防止が壊れる。追加により対象 2 ファイル (`resolveExecutablePath.ts` / `spawnGitScProcess.ts`) の statement カバレッジを 100% へ、総テストを 289 件へ引き上げた (残る未カバーは `error instanceof Error ? … : String(error)` 等の防御的分岐と、`updateStatusBarVisibility` の到達不能な `!statusBarItem` ガードのみ)。あわせて codex のセカンドオピニオン (gpt-5.5) でコードベース全体をバグ探索クロスチェックし、確実なバグ無しを独立に確認した。
- Added regression tests for `resolveNativeExecutableOnPath` が直接指定された `.exe` / `.com` (大文字 `.COM` 含む) を native 実行ファイルとして受理する正常系と、`resolveWindowsSystemExecutable` が `.exe` 付きで渡された名前に二重で `.exe` を付けずそのまま使う分岐 (`endsWith(".exe")`)。既存テストは拡張子なし指定・`.cmd`/`.bat` 拒否のみをカバーしており、`.exe`/`.com` を直接指定して受理される経路 (`candidateNames = [name]` 分岐と allowlist の `.toLowerCase()` 大文字小文字非依存判定) と `.exe` 二重付与回避分岐が未カバーだった。誤って allowlist から `.exe`/`.com` を落とす・`.exe` を無条件付与する実装に退行すると、`taskkill` / `git` の native 実行ファイル解決が壊れて cwd ハイジャック対策の絶対パス起動が機能しなくなるため回帰固定した (284 テストへ)。あわせて codex のセカンドオピニオン (gpt-5.5) でコードベース全体をバグ探索クロスチェックし、確実なバグ無しを独立に確認した。
- Added `tsconfig.tsbuildinfo` (TypeScript のインクリメンタルビルド情報ファイル) を `.gitignore` と `.vscodeignore` の双方に追加。`tsc -p ./` が生成するビルド成果物で `dist/` と同様に版管理対象外とすべきものが untracked のまま残っていた (`.gitignore` 側) うえ、`.vscodeignore` にも除外指定が無く `vsce package` の VSIX に同梱されて配布されていた (`.vscodeignore` 側) ため、両方で無視するよう修正した。
- Biome updated to 2.5.1, and `biome.jsonc` の `$schema` を 2.5.1 へ migrate (挙動のマイグレーションは無し、`biome lint` / `biome format` は無変更)。
- ovsx updated to 1.0.2.
- **Security fix (Windows `PATHEXT` の malformed 要素による候補パスずれ)**: Windows の `resolveExecutableOnPath` は `PATHEXT` を `;` で分割した値をそのまま `name + ext` として `path.win32.join(dir, ...)` に渡していたため、`PATHEXT=\..\..\evil.CMD;.CMD` のようにパス区切りを含む壊れた要素があると、join の正規化で `C:\safe\bin\git-sc\..\..\evil.CMD` 相当が `C:\safe\evil.CMD` のように PATH 要素外の候補へずれ得た。`PATHEXT` は拡張子リストなので、`.EXE` のように `.` で始まりパス区切り・ドライブ区切りを含まない値だけを採用する `getWindowsPathExtensions()` / `isSafeWindowsPathExtension()` を追加し、有効要素が 1 つも無い場合は従来どおり `.EXE;.CMD;.BAT;.COM` へフォールバックするよう修正。壊れた要素が先頭にあっても安全な `.CMD` 候補だけを探索する回帰テストと、有効要素なしならデフォルト拡張子で探索する回帰テストを追加。
- @types/node updated to 26.0.0 (major). 型定義のみのメジャー更新で、`tsc -p ./` の型チェックは無エラー、Vitest 279 テスト全件パス、`pnpm audit --audit-level moderate` は `No known vulnerabilities found` を維持。`biome migrate` は no-op (設定は最新)。`dependencyOverrides.test.ts` は `@types/vscode` と `engines.vscode` の整合のみ検証し `@types/node` は参照しないため、テスト更新は不要。本拡張のコード (child_process / path / fs の利用) に破壊的変更の影響なし。
- **Security fix (cmd.exe delayed expansion `!` の未拒否)**: `escapeCmdArgument` は制御文字・`%`・`"` を拒否していたが、cmd.exe が delayed expansion 有効時に二重引用符の内側でも展開する `!VAR!` を拒否していなかった。delayed expansion はレジストリ (`Command Processor\DelayedExpansion`) で全 cmd.exe に適用され得るため、`%` の `%VAR%` 展開と同型の脅威であり、解決された `git-sc.cmd` が `C:\Tools\!SC!\git-sc.cmd` のような `!VAR!` を含むパスにあり対応する環境変数が存在する場合、展開後の別パスを起動するパスリダイレクションの余地が残っていた (現行 UI の引数 -a/-b/-y/--reword/<hex hash> に `!` は含まれないため引数経路は通常踏まないが、helper としての防御欠落)。`%`/`"` と同様にコマンドライン上で `!` を確実にエスケープする手段が存在しないため、`escapeCmdArgument` で `!` を含む値を throw して reject するよう変更。あわせて `resolveSpawnCommand` の cmd.exe 起動引数を `["/d", "/s", "/c", commandLine]` → `["/d", "/s", "/v:off", "/c", commandLine]` とし、レジストリで delayed expansion が有効でも `/v:off` で当該 cmd.exe 実行に対し展開自体を無効化する二重防御を追加。`!` を含む引数・実行ファイルパスの reject 回帰テスト 2 件と、cmd.exe 経由起動の args 期待値 (`/v:off` 挿入) 更新を追加し、計 279 テスト全件パス。codex のセカンドオピニオン (gpt-5.5) で検出・修正レビュー済み。
- **Correctness fix (`isCommandNotFoundError` のハイフン境界誤検出)**: 未検出パターンが `\b` (単語境界) で `git-sc` を区切っていたが、JS の `\b` は `\w=[A-Za-z0-9_]` のみ単語文字とみなし `-` を境界扱いするため、`my-git-sc` や `git-sc-helper` のような別コマンド名の部分文字列にも誤マッチしていた。結果として git-sc 自身は起動済みで内部処理が別コマンド未検出により異常終了したケース (例: stderr に `command not found: git-sc-helper`) を「git-sc 未検出」と誤判定し、実際のエラーではなく誤ったインストール案内ダイアログを表示する恐れがあった。`git-sc` トークンを lookaround `(?<![\w-])git-sc(?![\w-])` (Windows 拡張子付きは `(?<![\w-])git-sc(?:\.(?:cmd|bat|exe))?(?![\w-])`) へ置換し、前後に単語文字・ハイフンが続かないことを明示。`.toLowerCase()` 後にマッチする従来挙動・真陽性 (POSIX `bash: git-sc: command not found` / Windows `'git-sc.cmd' is not recognized` / PowerShell `the term 'git-sc' ... cmdlet`) は不変で、`my-git-sc` / `git-sc-helper` を含む偽陽性 5 ケースの回帰テストを追加。codex のセカンドオピニオン (gpt-5.5) で検出・修正レビュー済み。
- Added regression test for `getGitWorkspaceRoot` の `stripGitTrailingLineTerminator` における「改行なし入力はそのまま返す」防御分岐 (`if (!output.endsWith("\n")) return output;`)。既存テストは全て末尾 `\n` を持つ入力だったため当該分岐が未カバーだった。末尾 1 文字を無条件に削る実装に退行するとパス本体を破壊し存在しない cwd で git-sc を spawn し得るため、改行なしの git 出力を不変で返すことを回帰固定した。
- @types/vscode updated to 1.125.0.
- VS Code engine requirement updated to `^1.125.0` to match `@types/vscode` and keep `vsce package --no-dependencies` valid. `dependencyOverrides.test.ts` now also checks that `engines.vscode` stays aligned with `@types/vscode`, so future API type updates do not leave package metadata behind.
- **Security fix (cmd.exe 経由経路でのダブルクォート escape 失敗)**: `escapeCmdArgument` の CommandLineToArgvW 互換 escape (`a"b` → `"a\"b"`) は target program 側の argv parser には有効だが、cmd.exe 自身の string parser には**有効ではない**。cmd.exe は `\` を `"` のエスケープとして解釈せず、`"` を string トグルとして扱うため、`"a\"b"` を cmd.exe `/d /s /c "..."` 経由で渡すと cmd.exe 側で引用が途中で閉じ、後続の `&` `|` `<` `>` `^` がコマンド区切りやリダイレクトとして露出し shell injection の余地が残っていた。`%` と同様に cmd.exe 上で安全に escape する手段が存在しないため、`escapeCmdArgument` で `"` を含む値を制御文字・`%` と並べて throw して reject するよう変更。これにより `spawnGitScWithProgress` の try/catch 経路で `Cannot safely launch git-sc` を明示通知してから reject する流れに合流する。現状 UI が組み立てる git-sc 引数 (-a/-b/-y/--reword/<hex hash>) には `"` が含まれないため通常操作では踏まないが、helper としての仕様バグだった。既存の「ダブルクォート escape を期待する」テスト 2 件 (`a"b` → `"a\"b"` / `a\"b` → `"a\\\"b"`) を「throw を期待する」テストへ書き換え (`cmd\.exe cannot safely quote` パターン)、末尾バックスラッシュ倍化 (`end\` → `"end\\"`) のテストは `"` を含まない正常系として維持。`resolveSpawnCommand` の `"` reject はバックスラッシュ前置の有無 (`a"b` / `a\"b`) で揺れないことも回帰テストで固定。codex のセカンドレビューでも、cmd.exe string parser と CommandLineToArgvW の差異・shell injection 露出経路・helper 仕様バグとしての確実性を確認。
- Vitest updated to 4.1.9.
- **Security maintenance (undici audit override)**: `pnpm audit --audit-level moderate` で `@vscode/vsce` / `ovsx` → `cheerio` 経由の `undici` に既知脆弱性が検出されたため、`pnpm-workspace.yaml` の override を `undici@>=7.0.0 <7.28.0` -> `7.28.0` へ更新した。最新 8 系ではなく `cheerio@1.1.2` の `undici@^7.12.0` と互換性を保つ 7 系 patched 下限に留め、lockfile を再生成した。`dependencyOverrides.test.ts` に `undici` override の退行チェックを追加し、`pnpm audit --audit-level moderate` は `No known vulnerabilities found`、Vitest は 274 テスト全件パスへ戻した。
- Biome updated to 2.5.0, and `biome.jsonc` migrated (`rules.recommended: false` → `rules.preset: "none"` 形式へ自動マイグレート)。
- ovsx updated to 1.0.1.
- **Reliability fix (settled 後の遅延キャンセル通知でプロセスを再 kill する race)**: `spawnGitScWithProgress` の `token.onCancellationRequested` ハンドラは `isCancelled` だけを確認しており、`close` / `error` 経由で `resolveOnce` / `rejectOnce` が走って `settled = true` になった後に VS Code 側からキャンセル通知が遅れて到着すると、終了済みプロセスに対して `terminateProcessForCancellation` を再実行 (POSIX なら `process.kill(-pid, "SIGTERM")` で既に終了したプロセスグループへ、Windows なら `taskkill /T /F` を再 spawn)、POSIX では 5 秒後 SIGKILL タイマーまで仕掛け、`outputChannel` に誤った「cancelled by user」ログを出していた。`shutdownTerminate` 側 (deactivate 経路) には既に `if (isCancelled || settled)` のガードがあるため、状態機械としても cancel ハンドラの一貫性が崩れていた。`if (isCancelled || settled)` のガードを cancel ハンドラにも追加し、settled 済みのキャンセル通知は早期 return して終了処理とログ出力をスキップするよう変更。commit / reword 両フローへ回帰テストを追加 (`should ignore cancellation after process has already settled` / `should ignore cancellation after reword has already settled`) し、`close(0)` で settled 後に `cancelHandler?.()` を呼んでも `proc.kill` 未実行・`taskkill` 未起動・「cancelled by user」ログ未出力であることを固定 (274 テストへ)。codex のセカンドレビューでも、settled 後の cancel 通知の race 発火条件、`shutdownTerminate` ガードとの整合、旧実装下では追加テストが失敗する設計を確認。
- Added regression tests for PowerShell cmdlet パターン (`The term '<name>' is not recognized as the name of a cmdlet`) で `.cmd` / `.bat` 拡張子付きのバリエーション。正規表現上は既にカバーされていたが explicit テストが無く、PATH に `git-sc.cmd` を直接登録しているユーザー環境で PowerShell から起動したケースの未検出退行を防ぐため固定した。
- @types/node updated to 25.9.3.
- Added regression test for POSIX で `PATH` 環境変数自体が未定義のときに `resolveExecutableOnPath` が null を返すことを固定。POSIX では Windows のような大文字小文字 fallback (`Path` / `path`) を行わず、`getPathEnvValue()` がそのまま空文字列を返して空配列を iterate するだけで終わる安全側の挙動を保証する。`mockAccessSync` / `mockStatSync` が一切呼ばれないことも併せて検証し、PATH 未定義時の偽 PATH ハイジャック余地を排除した (271 テストへ)。
- **Security maintenance (transitive dependency audit overrides)**: `pnpm audit --audit-level moderate` で dev-only の推移依存に既知脆弱性が検出されたため、`pnpm-workspace.yaml` の overrides を patched version へ更新した。対象は `esbuild@>=0.17.0 <0.28.1` -> `0.28.1`、`tmp@<0.2.7` -> `0.2.7`、`form-data@>=4.0.0 <4.0.6` -> `4.0.6`、`vite@>=7.0.0 <=7.3.4` -> `7.3.5`、`js-yaml@<=4.1.1` -> `4.2.0`、`markdown-it@<=14.1.1` -> `14.2.0`。Vite は最新 8 系ではなく、Vitest 4.1.8 の transitive dependency として互換性を保つため patched 下限の 7.3.5 に留めた。lockfile を再生成し、`pnpm audit --audit-level moderate` は `No known vulnerabilities found` へ戻した。さらに `dependencyOverrides.test.ts` を追加して、これらの security override が削除・退行しないことを Vitest で固定した (270 テストへ)。
- **Reliability fix (インストール案内リンクの `false` 解決を握りつぶし)**: `showGitScNotFoundMessage` の "View Installation" 経路は `vscode.env.openExternal(...)` の reject だけを `.catch()` していたが、VS Code API は `Thenable<boolean>` を返し `false` 解決が「オープンに失敗した」ことを示す。reject ではなく `false` でオープン失敗した場合、警告ログも通知も出ず失敗が握りつぶされ、直前の「reject 処理を追加」した設計意図 (URL オープン失敗時は `OutputChannel` に警告を記録する) と不整合だった。`.then(async (selection) => …)` で `openExternal` の戻り値を `await` し、`opened === false` のときだけ `OutputChannel` に `Failed to open installation guide: VS Code returned false` 警告を記録するよう変更。判定を `!opened` ではなく `opened === false` にしたのは、戻り値が `undefined`/`true` の場合 (テストのデフォルト mock や正常オープン) を失敗扱いしないため。修正は commit / reword 共通ヘルパー (`spawnGitScProcess.ts`) 1 箇所のため両フローに同時に効く。`false` 解決時の警告出力 (両フロー) と、`true` 解決時に警告を出さない回帰テストを追加 (267 テストへ)。codex のセカンドレビューでも `false` 失敗の捕捉・既存 reject 経路と `undefined` mock 挙動の非破綻・`await` 追加による promise タイミングの妥当性を確認。
- Added a regression test for `escapeCmdArgument` の CommandLineToArgvW 互換エスケープのうち、これまで未カバーだった「ダブルクォート直前のバックスラッシュ」分岐 (`a\"b` → `"a\\\"b"`) を `resolveSpawnCommand` 経由で固定。既存テストは「バックスラッシュを伴わない `"`」(`a"b`) と「末尾バックスラッシュの倍化」(`end\`) を個別に検証していたが、両者が隣接して `backslashes > 0` のまま `"` に到達する経路 (`"\\".repeat(backslashes * 2 + 1)` 分岐) は未テストだった。誤って `*2+1` を `+1` に潰すとバックスラッシュが 1 個に縮約され引数境界が崩れてインジェクションの余地が生じるため、`2n+1` 拡張を回帰テストで固定した (264 テストへ)。codex のセカンドレビューでも入力 4 文字 (`a`/`\`/`"`/`b`)・期待値 (`a` + バックスラッシュ 3 個 + `"`)・実装一致・未カバー分岐の的中を確認。
- **Reliability fix (インストール案内リンクの reject 処理)**: `showGitScNotFoundMessage` は "View Installation" 選択後に `vscode.env.openExternal(...)` を呼んでいたが、戻り値の Thenable に catch がなく、OS や VS Code 側で URL オープンが reject した場合に未処理 Promise rejection になり得た。`Promise.resolve(...).then(...).catch(...)` でダイアログ表示と URL オープンの双方を捕捉し、失敗時は `OutputChannel` に `Failed to open installation guide` 警告を記録するよう変更。`runGitSc` に openExternal reject の回帰テストを追加。
- @vscode/vsce updated to 3.9.2-1.
- Vitest updated to 4.1.8.
- **Correctness fix (POSIX で Git root 末尾 CR が欠落)**: `getGitWorkspaceRoot` は `git rev-parse --show-toplevel` の出力を `/\r?\n$/` で除去していたため、POSIX で実在し得る末尾 CR (`\r`) を含むパス (`…/repo\r`) において、git が付与する LF とともにパス本来の `\r` まで削っていた。結果として `spawn(..., { cwd: workspaceRoot })` が存在しない/別のディレクトリを cwd にして `git-sc` を起動し得た (POSIX のファイル/ディレクトリ名は `/` と NUL 以外を許容するため `\r` 終端のパスは有効)。新規 `stripGitTrailingLineTerminator` を導入し、POSIX では LF を 1 文字だけ除去、Windows でのみ CRLF (`\r\n`) を改行として 2 文字除去するよう変更 (Windows のパスには制御文字 `\r` を含められないため CRLF は常に改行とみなせる)。既存の「実在パス末尾の空白を保持」方針と同種の正確性修正で、空文字列入力 (→ 空文字のまま null 判定へ)・改行なし入力・`\r\n` 単体といった既存挙動は不変。POSIX で末尾 CR を保持する回帰テストを追加 (262 テストへ)。codex のセカンドレビューでも実装の正しさとエッジケースの非破綻を確認。
- **Security fix (Windows drive-relative PATH の除外)**: `path.win32.isAbsolute` は `\Tools` のような drive-relative パス (先頭が単一セパレータ) も true を返すが、これは実行時の current drive 依存で fully-qualified ではなく、`spawn(..., { cwd: workspaceRoot })` の cwd ドライブ次第で別ドライブ上の実行ファイル (`D:\Tools\git-sc.CMD` 等) を起動し得て cwd ハイジャック対策の前提を破っていた。新規 `isFullyQualifiedAbsolutePath(candidate, isWindows)` を導入し、Windows では drive-qualified (`C:\` / `C:/`) か server/share を備えた UNC (`\\server\share`) のみ許可するよう `resolveExecutableOnPath` / `resolveNativeExecutableOnPath` / `resolveWindowsSystemExecutable` の絶対パス判定を置換。退化した `\\` 単体や share なし `\\server` は `path.win32.join` で `\file` のような drive-relative パスに戻るため除外する。drive-relative な PATH 要素・SystemRoot の除外、退化 UNC 前置の除外、正規の UNC 受け入れの回帰テストを追加。
- **Security fix (cmd.exe の `%VAR%` 展開防止)**: `.cmd`/`.bat` を cmd.exe 経由起動する際、cmd.exe は二重引用符の内側でも `%VAR%` を環境変数展開し、コマンドライン上で `%` を確実にエスケープする手段が存在しない。`%` を含む実行ファイルパス/引数をそのまま渡すと展開後の別パス・別値を実行する恐れがあるため、`escapeCmdArgument` で `%` を含む値を制御文字と同様に throw して拒否し、誤実行を防ぐ。この throw は `spawnGitScWithProgress` で try/catch し、`outputChannel` と `showErrorMessage` で「Cannot safely launch git-sc」と失敗理由を明示してから reject する (握り潰して header だけ出る無言失敗を避ける)。`%` を含む引数・実行ファイルパスの拒否と、throw 時のエラー通知を検証する回帰テストを追加 (git-sc の実引数 -a/-b/-y/--reword/<hex hash> は `%` を含まないため通常は発生しない)。
- **Reliability fix (deactivate 時の git-sc 取り残し)**: 子プロセスは `spawnGitScWithProgress` のローカル変数でのみ保持され、キャンセル時しか kill されないため、VS Code の reload / 終了 / 拡張停止時に実行中の `git-sc` が孤児として残っていた (特に POSIX は `detached: true` で親終了に連動しない)。module-level `Map<ChildProcess, () => void>` で実行中プロセスと「終了ハンドラ」を追跡 (spawn 後に登録、`close`/`error` で delete) し、新規 export した `terminateActiveGitScProcesses(outputChannel)` を `deactivate()` から呼んで一括終了するよう変更。各終了ハンドラは内部で `isCancelled` を立ててから終了させるため、終了に伴う `close` が「キャンセル」扱いになり、拡張停止時に誤った成功/失敗通知や `git.refresh` が走らない。終了シグナルはグレースフルな SIGTERM (Windows は `taskkill /T /F`) とし、git 操作中断による破損や VS Code shutdown のタイムアウトで確実には走らない SIGKILL タイマーを避ける (SIGTERM 無視プロセスの強制終了は通常のユーザーキャンセル経路の 5 秒後 SIGKILL 昇格に委ねる)。`terminateActiveGitScProcesses` が実行中プロセスへ SIGTERM を送ること・その後の `close` で誤通知や `git.refresh` を出さないこと、`deactivate()` が outputChannel dispose 前にそれを呼ぶことの回帰テストを追加。
- **Refactor (commit / reword の spawn 重複解消)**: `runGitSc` と `rewordCommit` の `runGitScReword` に約 130 行重複していた `git-sc` の spawn + `withProgress` + キャンセル状態機械 (`isCancelled`/`settled`/`forceKillTimer`/`resolveOnce`/`rejectOnce`、`resolveSpawnCommand`、stdout/stderr・close/error/onCancellationRequested ハンドラ、SIGKILL 昇格、`git.refresh` 連携) を新規 `src/commands/spawnGitScProcess.ts` の `spawnGitScWithProgress({ outputChannel, workspaceRoot, args, messages })` へ抽出。security-sensitive な spawn/cancel ロジックを 1 箇所へ集約し、将来の修正漏れリスクを下げた。フロー固有の差分 (引数・進捗/成功/失敗/キャンセル文言) のみ `messages` で受け取り、表示文字列は旧実装とバイト一致を維持 (空 args 時の `Running: git-sc ` 末尾スペースを含む)。重複していた `showGitScNotFoundMessage` / `GIT_SC_INSTALLATION_URL` もヘルパーへ集約。挙動は不変で既存 249 テストは全てパスし、codex のセカンドレビューでも文言・分岐・状態機械の一致を確認。
- Added regression tests for `escapeCmdArgument` の CommandLineToArgvW 互換エスケープのうち、これまで未カバーだった引数内ダブルクォート (`a"b` → `"a\"b"`) と末尾バックスラッシュの倍化 (`end\` → `"end\\"`) を `resolveSpawnCommand` 経由で検証するケースを追加。
- Biome updated to 2.4.16.
- ovsx updated to 1.0.0.
- Added pnpm 11 `allowBuilds` entries for `@vscode/vsce-sign`, `esbuild`, and `keytar`, so `pnpm install --frozen-lockfile` succeeds non-interactively after dependency updates.
- Added regression test for rejecting same-name directories during Windows System32 executable resolution.
- Added regression test for Windows `.cmd` / `.bat` launch command line quoting when arguments include cmd.exe metacharacters (`&`, `|`, `<`, `>`, `^`).
- Added `tmp@<0.2.6` override in `pnpm-workspace.yaml` so `@vscode/vsce` no longer pulls vulnerable `tmp` 0.2.5 and `pnpm audit --audit-level moderate` reports no known vulnerabilities.
- Added regression test for lowercase Windows `windir` fallback during System32 command resolution.
- @types/node updated to 25.9.1.
- Vitest updated to 4.1.7.
- **Security fix (Node.js DEP0190 対応)**: Windows `.cmd` / `.bat` 起動を `shell: true` + `args` 配列の組み合わせから cmd.exe 経由起動 (`windowsVerbatimArguments: true` + 自前 quote) に変更。Node.js DEP0190 は `shell: true` + `args` の組み合わせが「値を escape せず空白連結する」ため shell injection のリスクがあるとして runtime deprecation 化されており、空白入り PATH や cmd.exe メタ文字 (`&` `|` `<` `>` `^`) を含む引数で injection の余地が残っていた。`resolveSpawnCommand` の API を `(name, args)` を受け取り `{ command, args, windowsVerbatimArguments }` を返す形に変更し、`.cmd` / `.bat` の場合だけ `SystemRoot\System32\cmd.exe` を絶対パスで解決して `["/d", "/s", "/c", "\"resolved\" \"arg1\" ..."]` に組み立てる。各引数は CommandLineToArgvW 互換で自前 quote する。
- **Security fix (キャンセル時の子孫プロセス漏れ)**: POSIX で `detached: true` で `git-sc` を spawn しプロセスグループを作るように変更。キャンセル時は `process.kill(-pid, "SIGTERM")` でグループ全体に SIGTERM を送り、`git-sc` が起動した `git` 等の孫プロセスもまとめて終了させる。グループ kill に失敗した場合は単体 PID にフォールバック。さらに `token.onCancellationRequested` ハンドラから即時 `resolveOnce()` を撤去し、`close` イベントでプロセス終了を確認してから resolve するよう変更。これにより、キャンセル直後に終了未確定のまま VS Code に成功通知が出て裏で `git-sc` が走り続ける事象を解消する。
- **Reliability fix (SIGTERM 無視時の永久 pending)**: POSIX で SIGTERM を `trap "" TERM` 等で無視するプロセスに備え、キャンセル後 5 秒経過しても `close` が来ない場合に SIGKILL に昇格してプロセスグループを強制終了するよう `runGitSc` / `rewordCommit` のキャンセルハンドラを更新。`terminateProcessForCancellation` も signal パラメータを受け付けるよう拡張。`close` / `error` 到達時は `forceKillTimer` をクリアして余計な SIGKILL を送らない。Windows は `taskkill /F` が既に強制終了相当なので追加昇格は不要。
- Added regression tests covering `getGitWorkspaceRoot` で `resolveNativeExecutableOnPath("git")` が複数フォルダ走査でも一度しか呼ばれないキャッシュ挙動と、多フォルダ列挙中に safe git executable が解決不能なら直ちに ENOENT を伝搬する挙動。
- Added regression tests for `isCommandNotFoundError` で複数行 stderr (POSIX のヘッダ + bash "command not found" 行 / Windows の "is not recognized" 行) の中間にパターンが現れても検出できること。
- Added regression tests for POSIX のプロセスグループ kill (`process.kill(-pid, "SIGTERM")`)、グループ kill 失敗時の単体 PID フォールバック、キャンセル後 close 待ち (close イベント発火まで Promise を解決しないこと)、Windows での cmd.exe 経由起動 (`shell:false` + `windowsVerbatimArguments:true`) と POSIX での `detached:true` 指定、空白入り PATH での自前 quote、改行・NUL を含む引数の例外送出、cmd.exe を解決できない場合の null フォールバック等。
- Added regression test for `terminateProcessForCancellation` で POSIX (linux/darwin) 上で `child.pid` が未定義の場合でも `child.kill("SIGTERM")` の呼び出しを試みること。
- Fixed Windows cancellation fallback so unresolved, failed-to-start, or non-zero-exiting `taskkill` now logs a warning and still sends `SIGTERM` to the direct child process.
- Added regression tests for `taskkill` resolution/startup/exit fallback paths and for avoiding duplicate SIGTERM fallback when `error` and `close` both fire.
- @types/node updated to 25.8.0.
- Moved patched transitive dependency overrides from the deprecated `package.json#pnpm.overrides` location to `pnpm-workspace.yaml`, matching pnpm 10 behavior and removing the package-time warning.
- Updated transitive dev dependency lockfile entries, including `@azure/identity` 4.13.1, so `@azure/msal-node` no longer pulls vulnerable `uuid` 8.x and `pnpm audit --audit-level moderate` reports no known vulnerabilities.
- Fixed `resolveExecutableOnPath` so Windows extension-qualified names (for example `git-sc.cmd`) are resolved only as the specified filename and no longer probe `PATHEXT`-appended variants such as `git-sc.cmd.EXE`.
- Added regression tests for extension-qualified Windows command lookup to ensure `PATHEXT` is not appended and the specified filename is preferred.
- Vitest updated to 4.1.6.
- Added dependency overrides for patched dev-only transitive dependencies so `pnpm audit --audit-level moderate` reports no known vulnerabilities.
- Added regression tests for lowercase Windows `path` environment fallback during PATH lookup and lowercase `systemroot` fallback during System32 command resolution.
- Biome updated to 2.4.15.
- Fixed `getGitWorkspaceRoot` so Git root paths ending with spaces are preserved; only the line terminator appended by `git rev-parse --show-toplevel` is removed.
- Added regression test for Git workspace roots with trailing spaces.
- Fixed `resolveNativeExecutableOnPath` so directly specified `.cmd` / `.bat` names are not returned as native Windows executables; native resolution now honors its `.exe` / `.com` contract even when the caller supplies an extension.
- Added regression test for directly specified `.CMD` names in Windows native executable resolution.
- @types/node updated to 25.6.2.
- ovsx updated to 0.10.12.
- Added regression tests for Windows `Path` environment fallback during PATH lookup and `WINDIR` fallback during System32 command resolution.
- Hardened executable resolution to require a regular file, so executable directories or same-name directories on PATH are no longer treated as valid `git-sc` / `git` candidates.
- Git CLI calls now resolve `git` to a safe native absolute executable path before `execFileSync`, while still passing repository location via `-C <dir>`.
- Windows cancellation now resolves `taskkill` via `SystemRoot\\System32\\taskkill.exe` or safe native PATH lookup before spawn, avoiding bare command execution; non-zero `taskkill` exits are logged to the output channel.
- Added regression tests for directory candidates on POSIX/Windows PATH, native-only `git` resolution, safe `taskkill` resolution/fallback/failure logging, and unresolved safe `git` executable errors.
- Hardened POSIX execution against cwd ハイジャック when `PATH` contains an empty entry, `.`, or a relative path. `resolveSpawnCommand` now resolves `git-sc` from executable absolute PATH entries on POSIX as well as Windows, and falls back to the installation guide when no safe absolute path is found.
- Biome updated to 2.4.13.
- Added direct unit tests for `terminateProcessForCancellation`, covering POSIX `SIGTERM`, Windows `taskkill`, and both synchronous/asynchronous `taskkill` startup failures.
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
- Fixed duplicate UI notifications in `runGitSc` / `rewordCommit` when `spawn("git-sc")` fails on POSIX. Node.js fires both `error` (ENOENT) and `close` (code=null) events, so the `close`/`error` handlers now check the shared `settled` flag before writing to `outputChannel` or calling `showErrorMessage`. Previously users saw both the "git-sc command not found" install dialog and a subsequent "failed: Process exited with code ..." error for a single spawn failure.
- Added regression tests that emit `error` followed by `close` to verify only one UI notification and no duplicate `failed with code` log line appears in both commit and reword flows.
- Hardened Windows execution against cwd ハイジャック (悪意ある repo 直下の `git-sc.cmd` / `git.exe` 優先実行)。新規 `src/commands/resolveExecutablePath.ts` で `PATH` を走査し、絶対パス要素のみから実行ファイルを解決する。空文字列・`"."`・`"./"`・`".\\"`・`"bin"`・`".\tools"`・`"C:tools"` 等の相対要素は `path.win32.isAbsolute` で全て除外。`runGitSc` / `rewordCommit` の `spawn` を `resolveSpawnCommand` 経由に置き換え、解決失敗時はフォールバック spawn せずインストール案内へ誘導する。
- Switched `getGitWorkspaceRoot`、`getRecentCommits`、`getCommitCount` の git 呼び出しを `cwd: <dir>` から `git -C <dir> ...` 引数渡しに変更。Windows の `CreateProcess` が `cwd` を実行ファイル探索パスに含める仕様による cwd ハイジャックリスクを排除した。
- Fixed `isCommandNotFoundError` で POSIX 終了コード 127 を単独で「未検出」と判定していた誤判定を修正。本拡張は POSIX で `shell: false` で git-sc を spawn するため、`close` で来る 127 は git-sc 自身の終了コード。 9009 (Windows cmd.exe) のみを exit code で判定し、127 はメッセージパターン一致時のみ未検出扱いとする。
- Wrapped `vscode.commands.executeCommand("git.refresh")` calls with `Promise.resolve(...).catch(...)` in both `runGitSc` and `rewordCommit` so that Git 拡張が無効化されている環境で発生する reject が未処理 rejection にならず、`OutputChannel` に警告として記録される。
- Added regression tests for: `resolveSpawnCommand` 解決失敗時の早期フォールバック (`spawn` を呼ばずインストール案内)、`git.refresh` reject 時の `OutputChannel` 記録、`resolveExecutableOnPath` の PATH 相対要素除外、`PATHEXT` 既定値、絶対パス検出、空 PATH ハンドリングなど。
- Biome updated to 2.4.14.
- Fixed `resolveExecutableOnPath` で `PATHEXT` が空文字列・空白のみ・セパレータのみ (`";"` や `" ; ; "`) の場合に `pathExts` が空配列になり、Windows で `.EXE` / `.CMD` / `.BAT` / `.COM` の探索が一切走らず誤って未検出扱いになるバグを修正。`??` で素通ししていた箇所をデフォルト `.EXE;.CMD;.BAT;.COM` へフォールバックするロジックに置き換えた。
- Added regression tests for `PATHEXT=""` / `"   "` / `" ; ; "` の各エッジケースでデフォルト拡張子へフォールバックして探索が走ることを検証。
- Fixed `isCommandNotFoundError` で Windows 終了コード 9009 を単独で「未検出」と判定していた誤判定を解消。本拡張は spawn 前に `resolveSpawnCommand` で git-sc を絶対パスに解決し、解決失敗時はそもそも spawn しないため、起動済みプロセスから返る 9009 は git-sc 自身もしくは内部依存コマンド (例: `git-sc.cmd` 内部の `node`) の異常終了として扱う必要がある。これに合わせて signature を `isCommandNotFoundError(errorMessage: string)` に簡素化し、判定はメッセージパターン一致のみで行うよう統一した。
- Extended Windows command-not-found patterns に `git-sc.cmd` / `git-sc.bat` / `git-sc.exe` の拡張子付き報告を許容するよう正規表現を更新。cmd.exe や PowerShell が拡張子付きで「is not recognized」メッセージを返した場合でも未検出を検知できる。
- Updated `runGitSc` / `rewordCommit` の `isCommandNotFoundError` 呼び出しを新 signature (`errorMessage` のみ) に追随。終了コード単独判定の経路は撤去された。
- Added regression tests covering the new `.cmd`/`.bat`/`.exe` 拡張子報告 patterns, and removed obsolete exit-code-only tests that no longer reflect the real spawn pre-resolution behavior.
- Added regression tests for `terminateProcessForCancellation` covering Windows での `child.pid === undefined` 時の SIGTERM フォールバック、`taskkill` の正常終了 (code 0) での warning 非出力、`taskkill` の `close` で code が `null` (シグナルキル) になるケースの warning 出力。
- @types/node updated to 25.7.0 (lockfile installs 25.9.1 within the caret range).

## VS Code Extension Details

- **Activation**: `workspaceContains:.git`
- **Engine**: `vscode ^1.125.0`
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
