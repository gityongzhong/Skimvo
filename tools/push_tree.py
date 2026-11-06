"""代理阻断 git push 时的推送通道：Git Database REST API（增量 tree，不依赖本地 pack）。

与 tools/sync_github.py 的区别
------------------------------
sync_github.py 用 `git diff --name-status` 求差异，依赖本地有父 commit 的 tree 对象；
一旦历史上出现过 API 重建 ref，本地就可能缺 tree 而报 `bad tree object HEAD`。
本脚本改为「本地索引 blob SHA ↔ 远端 tree 逐文件比对」，只上传真正变化的 blob，
再以 `base_tree` 增量合并，全程不需要 pack、也不需要读本地历史。

也**不会**改写本地 ref —— 让本地历史保持自洽（宁可两边 SHA 不同，也不要造出缺对象的提交）。

用法
----
    python tools/push_tree.py <owner/repo> [branch] [-m "提交信息"]
    python tools/push_tree.py gityongzhong/Skimvo main -m "docs: 换图"
"""
import base64
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

GH = "gh"


def git(*args, binary=False):
    r = subprocess.run(["git", *args], capture_output=True, check=True)
    return r.stdout if binary else r.stdout.decode("utf-8", "replace")


def gh_api(method, path, payload=None):
    cmd = [GH, "api", "--method", method, path]
    if payload is not None:
        fd, tmp = tempfile.mkstemp(suffix=".json")
        os.close(fd)
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(payload, f)
        cmd += ["--input", tmp]
    try:
        r = subprocess.run(cmd, capture_output=True, text=True)
    finally:
        if payload is not None:
            os.unlink(tmp)
    if r.returncode != 0:
        raise RuntimeError(f"gh api {method} {path} 失败:\n{r.stderr.strip()}")
    out = r.stdout.strip()
    return json.loads(out) if out else None


def local_index():
    """工作区实际内容 → {path: (mode, blob_sha)}，blob 写入本地对象库。"""
    out = {}
    for line in git("ls-files", "-s").splitlines():
        meta, path = line.split("\t", 1)
        mode, sha, _stage = meta.split()
        out[path] = (mode, sha)
    return out


def remote_blobs(tree_sha):
    data = gh_api("GET", f"repos/{REPO}/git/trees/{tree_sha}?recursive=1")
    return {e["path"]: e["sha"] for e in data.get("tree", []) if e["type"] == "blob"}


def main():
    global REPO
    args = [a for a in sys.argv[1:] if not a.startswith("-m")]
    REPO = args[0]
    branch = args[1] if len(args) > 1 else "main"
    msg = "sync"
    if "-m" in sys.argv:
        msg = sys.argv[sys.argv.index("-m") + 1]

    head = gh_api("GET", f"repos/{REPO}/git/ref/heads/{branch}")["object"]["sha"]
    parent_tree = gh_api("GET", f"repos/{REPO}/git/commits/{head}")["tree"]["sha"]
    print(f"远端 {branch} @ {head[:8]}  tree {parent_tree[:8]}")

    local = local_index()
    remote = remote_blobs(parent_tree)

    upload, delete = [], sorted(set(remote) - set(local))
    for path, (mode, sha) in local.items():
        if remote.get(path) != sha:
            upload.append((path, mode, sha))

    if not upload and not delete:
        print("✓ 内容已一致，无需推送")
        return 0

    print(f"待上传 {len(upload)} 个、待删除 {len(delete)} 个")
    entries = []
    for path, mode, sha in upload:
        blob = Path(path).read_bytes()
        res = gh_api("POST", f"repos/{REPO}/git/blobs", {
            "content": base64.b64encode(blob).decode(),
            "encoding": "base64",
        })
        if res["sha"] != sha:
            raise RuntimeError(f"blob SHA 不一致: {path} 本地 {sha[:8]} 远端 {res['sha'][:8]}")
        entries.append({"path": path, "mode": mode, "type": "blob", "sha": sha})
        print(f"  ↑ {path}  {len(blob) // 1024 or '<1'} KB")
    for path in delete:
        entries.append({"path": path, "mode": "100644", "type": "blob", "sha": None})
        print(f"  × {path}")

    tree = gh_api("POST", f"repos/{REPO}/git/trees",
                  {"base_tree": parent_tree, "tree": entries})["sha"]
    commit = gh_api("POST", f"repos/{REPO}/git/commits",
                    {"message": msg, "tree": tree, "parents": [head]})["sha"]
    gh_api("PATCH", f"repos/{REPO}/git/refs/heads/{branch}",
           {"sha": commit, "force": True})
    print(f"✓ 已推送 {commit[:8]} → https://github.com/{REPO}/commits/{branch}")
    return 0


REPO = ""
if __name__ == "__main__":
    sys.exit(main())
