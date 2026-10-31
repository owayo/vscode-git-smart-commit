"""空リポジトリ判定の全件走査と1件限定走査を、同じ履歴で比較する。"""

import argparse
import json
import os
import pathlib
import platform
import statistics
import subprocess
import tempfile
import time

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument("--git", required=True, type=pathlib.Path)
parser.add_argument("--runs", type=int, default=15)
args = parser.parse_args()
if not args.git.is_absolute() or args.runs < 1:
    parser.error("--git は絶対パス、--runs は正の整数で指定してください")

# 利用者の Git 設定や署名・フックの影響を受けない使い捨ての履歴を作る。
env = dict(os.environ, GIT_CONFIG_GLOBAL=os.devnull, GIT_CONFIG_NOSYSTEM="1")
for key in list(env):
    if key.startswith("GIT_") and key not in ("GIT_CONFIG_GLOBAL", "GIT_CONFIG_NOSYSTEM"):
        del env[key]


def run(repo, command, **kwargs):
    return subprocess.run(
        [str(args.git), "-C", str(repo), *command],
        env=env, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs,
    )


def measure(repo, command):
    started = time.perf_counter_ns()
    child = subprocess.Popen(
        [str(args.git), "-C", str(repo), *command],
        env=env, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
    )
    usage = None
    if hasattr(os, "wait4"):
        # 出力は件数の数バイトだけなので、pipe が詰まることはない。
        _, status, usage = os.wait4(child.pid, 0)
        child.returncode = os.waitstatus_to_exitcode(status)
    stdout, stderr = child.communicate()
    elapsed = (time.perf_counter_ns() - started) / 1e6
    if child.returncode:
        raise RuntimeError(stderr.decode())
    return {
        "wall_ms": elapsed,
        "cpu_ms": (usage.ru_utime + usage.ru_stime) * 1000 if usage else None,
        # macOS の ru_maxrss は bytes、Linux は KiB。
        "peak_rss_kib": usage.ru_maxrss / (1024 if platform.system() == "Darwin" else 1)
        if usage else None,
        "count": int(stdout),
    }


result = {
    "system": platform.system(), "machine": platform.machine(),
    "git": subprocess.check_output([str(args.git), "--version"], env=env, text=True).strip(),
    "runs": args.runs, "warmups": 3, "cases": [],
}
with tempfile.TemporaryDirectory(prefix="history-probe-") as temp:
    root = pathlib.Path(temp)
    for count in (0, 100, 50000):
        repo = root / str(count)
        repo.mkdir()
        run(repo, ["init", "-b", "main"])
        if count:
            data = "".join(
                f"commit refs/heads/main\nmark :{i}\n"
                f"committer Benchmark <you@example.com> {1700000000 + i} +0000\n"
                "data 4\ntest\n"
                + (f"from :{i - 1}\n" if i > 1 else "") + "\n"
                for i in range(1, count + 1)
            )
            run(repo, ["fast-import", "--quiet"], input=data.encode())
            # HEAD に履歴がなくても、他の ref に到達可能なコミットは残す。
            run(repo, ["symbolic-ref", "HEAD", "refs/heads/empty"])
        commands = {
            "before": ["rev-list", "--count", "--all"],
            "after": ["rev-list", "--count", "--max-count=1", "--all"],
        }
        samples = {key: [] for key in commands}
        for command in commands.values():
            for _ in range(3):
                run(repo, command)
        for iteration in range(args.runs):
            # 実行順の偏りを抑えるため、旧・新の順序を交互に変える。
            for key in (("before", "after") if iteration % 2 == 0 else ("after", "before")):
                sample = measure(repo, commands[key])
                assert sample["count"] == (count if key == "before" else min(count, 1))
                samples[key].append(sample)
        result["cases"].append({
            "commits": count, "samples": samples,
            "median": {
                key: {metric: statistics.median(s[metric] for s in rows)
                      if rows[0][metric] is not None else None
                      for metric in ("wall_ms", "cpu_ms", "peak_rss_kib")}
                for key, rows in samples.items()
            },
        })
print(json.dumps(result, indent=2))
