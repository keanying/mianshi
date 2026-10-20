"""Assemble the interviewer workbench into one offline HTML file.

Usage:
    python3 scripts/build.py            # full build: pool + résumés found in private/resumes/
    python3 scripts/build.py --public   # pool only, safe to publish (no candidate data)
"""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
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
    candidates = [load(p) for p in sorted(folder.glob("resume_*.json"))] if folder.exists() else []
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


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--public", action="store_true", help="exclude résumé data")
    args = parser.parse_args()

    categories, questions = build_pool()
    candidates = [] if args.public else load_candidates()
    data = {"categories": categories, "questions": questions, "candidates": candidates}
    # 内嵌在 <script type="application/json"> 中，需转义 "</" 以免提前闭合标签。
    payload = json.dumps(data, ensure_ascii=False, separators=(",", ":")).replace("</", "<\\/")

    filename = "interview-workbench-public.html" if args.public else "interview-workbench.html"
    html = (ROOT / "src/shell.html").read_text(encoding="utf-8")
    for key, value in {
        "{{STYLE}}": (ROOT / "src/style.css").read_text(encoding="utf-8"),
        "{{METHOD}}": (ROOT / "src/method.html").read_text(encoding="utf-8"),
        "{{SCRIPT}}": (ROOT / "src/app.js").read_text(encoding="utf-8"),
        "{{FILENAME}}": filename,
        "{{DATA}}": payload,
    }.items():
        html = html.replace(key, value)

    out = ROOT / "dist" / filename
    out.parent.mkdir(exist_ok=True)
    out.write_text(html, encoding="utf-8")
    resume_count = sum(len(b["questions"]) for c in candidates for b in c["blocks"])
    print(f"{out.relative_to(ROOT)}: {len(questions)} pool questions, "
          f"{len(candidates)} candidates, {resume_count} résumé questions")


if __name__ == "__main__":
    main()
