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
# 五个评估维度（见 docs/五维题规范.md）。早期题目用三维标签，构建时换成对应的新代码。
DIMS = {"pro", "drive", "trait", "logic", "adapt"}
LEGACY = {"exp": "logic", "ext": "adapt"}
# 简历分块题覆盖的三维；自驱力、性格特质集中在每份简历的「五维题」块（kind: dim）。
BLOCK_DIMS = {"pro", "logic", "adapt"}

# 新增分类接在原 23 个分类之后，下标与 data/pool/added.json 中的 category 对应。
# 侧栏分组：28 个分类归为 7 组；没有题目的分类（如已拆分完的「补充深度场景与追问」）在页面上自动隐藏。
GROUPS = [
    ("架构与编排", [0, 4, 9, 3, 21, 22]),
    ("模型与生成", [2, 14, 25]),
    ("检索与知识", [7, 8, 24, 6, 23]),
    ("工程与可靠性", [1, 11, 13, 5, 12]),
    ("质量与交付", [10, 16, 17, 19]),
    ("业务场景", [15, 20]),
    ("现场与表达", [27, 18, 26]),
]

NEW_CATEGORIES = [
    "NL2SQL 与数据分析智能体",
    "知识图谱与 GraphRAG",
    "多模态、文档解析与领域微调",
    "项目表达与情景应变",
    "五维通用题",
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
    # curation.json：每题一个主维度 dim，过长题目的精简版，以及从「补充深度场景」改到具体主题的分类。
    curation = load(ROOT / "data/pool/curation.json")
    for q in questions:
        fix = curation[str(q["id"])]
        q["dims"] = [LEGACY.get(fix["dim"], fix["dim"])]
        if fix.get("question_short"):
            q["question"] = fix["question_short"]
        if "category" in fix:
            q["category"] = fix["category"]
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
            for q in b["questions"]:
                q["dim"] = LEGACY.get(q["dim"], q["dim"])
                assert q["id"] not in seen, q["id"]
                assert q["dim"] in DIMS, q["id"]
                seen.add(q["id"])
            dims = {q["dim"] for q in b["questions"]}
            if b.get("kind") == "dim":
                assert dims == {b["dim"]}, f"{b['id']}: questions must all be {b['dim']}"
                if not 6 <= len(b["questions"]) <= 10:
                    print(f"warning: {b['id']} has {len(b['questions'])} questions (expected 6-10)", file=sys.stderr)
            elif dims != BLOCK_DIMS:
                print(f"warning: {b['id']} covers only {sorted(dims)}", file=sys.stderr)
        missing = DIMS - {b.get("dim") for b in c["blocks"] if b.get("kind") == "dim"}
        if missing:
            print(f"warning: {c['id']} has no 五维题 for {sorted(missing)}", file=sys.stderr)
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
    render({"categories": categories, "groups": GROUPS, "questions": questions, "candidates": [], "locked": locked})
    resume_count = sum(len(b["questions"]) for c in candidates for b in c["blocks"])
    print(f"index.html: {len(questions)} pool questions, "
          f"{len(candidates)} encrypted résumé boards ({resume_count} questions)")


if __name__ == "__main__":
    main()
