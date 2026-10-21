"""Assemble the interviewer workbench into one offline page: index.html at the repo root.

Usage:
    python3 scripts/build.py

The general pool is embedded as plain JSON. Résumé boards from private/resumes/<ID>/ are
embedded encrypted (see scripts/vault.py) and unlock in the page with the same password.
"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import vault  # noqa: E402
DIMS = {"pro", "exp", "ext"}

# 新增分类接在原 23 个分类之后，下标与 data/pool/added.json 中的 category 对应。
NEW_CATEGORIES = [
    "NL2SQL 与数据分析智能体",
    "知识图谱与 GraphRAG",
    "多模态、文档解析与领域微调",
    "项目表达与情景应变",
]


def load(path):
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def build_pool():
    base = load(ROOT / "data/pool/base.json")
    enrich = load(ROOT / "data/pool/enrich.json")
    added = load(ROOT / "data/pool/added.json")
    categories = base["categories"] + NEW_CATEGORIES
    questions = []
    for q in base["questions"]:
        extra = enrich[str(q["id"])]
        q = dict(q)
        if extra.get("question_new"):
            q["question"] = extra["question_new"]
        q.update({k: extra[k] for k in ("dims", "good", "bad", "twist")})
        questions.append(q)
    next_id = max(q["id"] for q in questions) + 1
    for q in added:
        q = dict(q)
        q["id"] = next_id
        next_id += 1
        questions.append(q)
    for q in questions:
        assert 0 <= q["category"] < len(categories), q["id"]
        assert q["dims"] and set(q["dims"]) <= DIMS, q["id"]
        assert len(q["points"]) >= 2 and q["follow"] and q["twist"], q["id"]
    questions.sort(key=lambda q: (q["category"], q["id"]))
    return categories, questions


def load_candidates():
    folder = ROOT / "private/resumes"
    # 每份简历一个目录：private/resumes/<ID>/resume.md（转录原文）+ questions.json（板块题目）。
    paths = sorted(folder.glob("*/questions.json")) if folder.exists() else []
    candidates = [load(p) for p in paths]
    for path, c in zip(paths, candidates):
        assert c["id"] == path.parent.name, f"{path}: id {c['id']} does not match its directory"
    seen = set()
    for c in candidates:
        for b in c["blocks"]:
            dims = {q["dim"] for q in b["questions"]}
            if dims != DIMS:
                print(f"warning: {b['id']} covers only {sorted(dims)}", file=sys.stderr)
            for q in b["questions"]:
                assert q["id"] not in seen, q["id"]
                assert q["dim"] in DIMS, q["id"]
                seen.add(q["id"])
        c.pop("poolCandidates", None)
    return candidates


def render(data):
    # 内嵌在 <script type="application/json"> 中，需转义 "</" 以免提前闭合标签。
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")
    html = (ROOT / "src/shell.html").read_text(encoding="utf-8")
    for key, value in {
        "{{STYLE}}": (ROOT / "src/style.css").read_text(encoding="utf-8"),
        "{{METHOD}}": (ROOT / "src/method.html").read_text(encoding="utf-8"),
        "{{SCRIPT}}": (ROOT / "src/app.js").read_text(encoding="utf-8"),
        "{{DATA}}": payload,
    }.items():
        html = html.replace(key, value)
    (ROOT / "index.html").write_text(html, encoding="utf-8")


def main():
    categories, questions = build_pool()
    candidates = load_candidates()
    if not candidates and vault.VAULT.exists():
        sys.exit("private/resumes/ is empty: run `python3 scripts/vault.py open` first, "
                 "otherwise the page would ship without the résumé boards")
    locked = None
    if candidates:
        plain = json.dumps(candidates, ensure_ascii=False, separators=(",", ":")).encode()
        locked = vault.seal(plain, vault.password())
    render({"categories": categories, "questions": questions, "candidates": [], "locked": locked})
    resume_count = sum(len(b["questions"]) for c in candidates for b in c["blocks"])
    print(f"index.html: {len(questions)} pool questions, "
          f"{len(candidates)} encrypted résumé boards ({resume_count} questions)")


if __name__ == "__main__":
    main()
