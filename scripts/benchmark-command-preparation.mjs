// コマンドの準備処理 (リポジトリの検出・履歴の取得・実行ファイルの解決) を、コンパイル済みの
// dist を差し替えながら同じ入力で計測する。測るのは、完了までの時間と、その間に拡張ホストの
// イベントループが止まった最長の時間 (1ms 間隔のタイマーの最大の空き) の 2 つ。
//
// 使い方:
//   node scripts/benchmark-command-preparation.mjs --dist before=/path/to/dist --dist after=dist [--runs 30]
// 結果は JSON で標準出力に出す。比較する dist は交互に実行し、実行順の偏りを抑える。

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from "node:fs";
import Module, { createRequire } from "node:module";
import { arch, platform, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { setTimeout as delay } from "node:timers/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
	options: {
		dist: { type: "string", multiple: true },
		runs: { type: "string", default: "30" },
	},
});
const runs = Number(values.runs);
const dists = (values.dist ?? []).map((entry) => {
	const separator = entry.indexOf("=");
	if (separator <= 0) {
		throw new Error(
			`--dist は <名前>=<ディレクトリ> で指定してください: ${entry}`,
		);
	}
	return {
		label: entry.slice(0, separator),
		dir: resolve(entry.slice(separator + 1)),
	};
});
if (dists.length === 0 || !Number.isInteger(runs) || runs < 1) {
	throw new Error("--dist を 1 つ以上と、正の整数の --runs を指定してください");
}
// 同じ名前の dist があると、別のビルドの計測値が 1 つの名前に混ざる。
if (new Set(dists.map(({ label }) => label)).size !== dists.length) {
	throw new Error("--dist の名前が重複しています");
}

// 計測対象のモジュールは vscode を import するが、計測する関数は UI を使わない。
const originalLoad = Module._load;
Module._load = function load(request, ...rest) {
	return request === "vscode" ? {} : originalLoad.call(this, request, ...rest);
};
const require = createRequire(import.meta.url);

const root = realpathSync(mkdtempSync(join(tmpdir(), "command-preparation-")));

// 利用者の Git 設定や署名・フックの影響を受けない使い捨ての履歴を作る。一時ディレクトリが
// 別のリポジトリの中にあっても、そのリポジトリを見つけないよう探索を一時ディレクトリで止める。
for (const key of Object.keys(process.env)) {
	if (key.startsWith("GIT_")) delete process.env[key];
}
process.env.GIT_CONFIG_GLOBAL = platform() === "win32" ? "NUL" : "/dev/null";
process.env.GIT_CONFIG_NOSYSTEM = "1";
process.env.GIT_CEILING_DIRECTORIES = root;

function git(repo, args, input) {
	return execFileSync("git", ["-C", repo, ...args], {
		encoding: "utf8",
		input,
		stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
	});
}

function createRepository(name, commits) {
	const repo = join(root, name);
	mkdirSync(repo);
	git(repo, ["init", "-b", "main"]);
	let data = "";
	for (let i = 1; i <= commits; i += 1) {
		data += `commit refs/heads/main\nmark :${i}\n`;
		data += `committer Benchmark <you@example.com> ${1700000000 + i} +0000\n`;
		data += `data 9\nsubject ${i % 10}\n`;
		data += i > 1 ? `from :${i - 1}\n\n` : "\n";
	}
	git(repo, ["fast-import", "--quiet"], data);
	return repo;
}

// 同期の関数と非同期の関数を同じように測る。1ms 間隔のタイマーを走らせ、計測区間
// (呼び出しから完了まで) でタイマーの刻みが空いた最長の間隔を、イベントループが止まった時間とみなす。
async function measure(fn) {
	let last = 0;
	let maxGap = 0;
	const timer = setInterval(() => {
		const now = performance.now();
		maxGap = Math.max(maxGap, now - last);
		last = now;
	}, 1);
	try {
		// タイマーが刻み始めてから計測を始める
		await delay(5);
		const started = performance.now();
		last = started;
		maxGap = 0;
		await fn();
		const ended = performance.now();
		// 最後の刻みから完了までを区間に含める。同期の関数は呼び出し中に一度も刻めないので、
		// この区間が止まっていた時間になる。完了後のタイマーの遅れは数えない。
		return {
			totalMs: ended - started,
			blockingMs: Math.max(maxGap, ended - last),
		};
	} finally {
		clearInterval(timer);
	}
}

function median(samples) {
	const sorted = [...samples].sort((a, b) => a - b);
	const middle = Math.floor(sorted.length / 2);
	return sorted.length % 2 === 0
		? (sorted[middle - 1] + sorted[middle]) / 2
		: sorted[middle];
}

try {
	const small = createRepository("history-100", 100);
	const large = createRepository("history-50000", 50_000);
	// 先頭に Git 管理外のフォルダーが並ぶマルチルートのワークスペース
	const plainFolders = Array.from({ length: 10 }, (_, index) => {
		const folder = join(root, `plain-${index}`);
		mkdirSync(folder);
		return { uri: { fsPath: folder } };
	});

	const modules = dists.map(({ label, dir }) => ({
		label,
		rewordCommit: require(join(dir, "commands", "rewordCommit.js")),
		workspaceRoot: require(join(dir, "commands", "getGitWorkspaceRoot.js")),
		executable: require(join(dir, "commands", "resolveExecutablePath.js")),
	}));

	// 管理外のフォルダーが本当に管理外として判定されることを、計測の前に確かめる。
	for (const mod of modules) {
		const detected = await mod.workspaceRoot.getGitWorkspaceRoot(plainFolders);
		if (detected !== null) {
			throw new Error(
				`${mod.label}: 管理外のはずのフォルダーから ${detected} を検出しました`,
			);
		}
	}

	const cases = [
		{
			name: "getRecentCommits (100 commits, 15 items)",
			run: (mod) => mod.rewordCommit.getRecentCommits(small, 15),
		},
		{
			name: "getRecentCommits (50,000 commits, 15 items)",
			run: (mod) => mod.rewordCommit.getRecentCommits(large, 15),
		},
		{
			name: "getGitWorkspaceRoot (1 folder)",
			run: (mod) =>
				mod.workspaceRoot.getGitWorkspaceRoot([{ uri: { fsPath: small } }]),
		},
		{
			name: "getGitWorkspaceRoot (10 plain folders before the repository)",
			run: (mod) =>
				mod.workspaceRoot.getGitWorkspaceRoot([
					...plainFolders,
					{ uri: { fsPath: small } },
				]),
		},
		{
			name: "resolveSpawnCommand (git on PATH)",
			run: (mod) => mod.executable.resolveSpawnCommand("git", ["--version"]),
		},
	];

	const result = {
		system: platform(),
		machine: arch(),
		node: process.version,
		git: execFileSync("git", ["--version"], { encoding: "utf8" }).trim(),
		runs,
		warmups: 3,
		cases: [],
	};
	for (const testCase of cases) {
		const samples = Object.fromEntries(
			modules.map(({ label }) => [label, { totalMs: [], blockingMs: [] }]),
		);
		for (const mod of modules) {
			for (let i = 0; i < 3; i += 1) await testCase.run(mod);
		}
		for (let iteration = 0; iteration < runs; iteration += 1) {
			// 実行順の偏りを抑えるため、比較対象の順序を毎回入れ替える。
			const ordered = iteration % 2 === 0 ? modules : [...modules].reverse();
			for (const mod of ordered) {
				const sample = await measure(() => testCase.run(mod));
				samples[mod.label].totalMs.push(sample.totalMs);
				samples[mod.label].blockingMs.push(sample.blockingMs);
			}
		}
		const round = (value) => Number(value.toFixed(3));
		result.cases.push({
			name: testCase.name,
			median_ms: Object.fromEntries(
				Object.entries(samples).map(([label, { totalMs, blockingMs }]) => [
					label,
					{
						total: round(median(totalMs)),
						blocking: round(median(blockingMs)),
					},
				]),
			),
			samples_ms: Object.fromEntries(
				Object.entries(samples).map(([label, { totalMs, blockingMs }]) => [
					label,
					{ total: totalMs.map(round), blocking: blockingMs.map(round) },
				]),
			),
		});
	}
	console.log(JSON.stringify(result, null, 2));
} finally {
	rmSync(root, { recursive: true, force: true });
}
