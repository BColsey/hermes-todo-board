"""Todo board dashboard API — multi-project read/write over ~/Documents/todo/.

Storage: ~/Documents/todo/ with one markdown file per project (## Now/Next/
Later/Done sections). `personal.md` is the default project (the human board).
A legacy ~/Documents/todo.md is migrated to todo/personal.md on first load
(backup kept alongside). Project colors are derived deterministically from the
project id via a fixed palette shared with every surface (desktop, widget,
digest email). Auth is supplied by the dashboard host.
"""

from __future__ import annotations

import os
import re
import shutil
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

DOCS = Path.home() / "Documents"
TODO_DIR = DOCS / "todo"
LEGACY = DOCS / "todo.md"
SECTIONS = ["Now", "Next", "Later", "Done"]
MAX_TEXT = 300

PALETTE = ["#3b82f6", "#22c55e", "#eab308", "#f97316", "#ef4444", "#a855f7", "#14b8a6", "#ec4899"]
SQUARES = ["🟦", "🟩", "🟨", "🟧", "🟥", "🟪", "🟦", "🟪"]  # emoji echo of the palette


def color_of(pid: str) -> str:
    return PALETTE[hash_text(pid) % len(PALETTE)]


def square_of(pid: str) -> str:
    return SQUARES[hash_text(pid) % len(SQUARES)]


def hash_text(t: str) -> int:
    h = 0
    for ch in t:
        h = (h * 31 + ord(ch)) & 0xFFFFFFFF
    return h


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-")
    return s[:40] or "project"


def _migrate_if_needed() -> None:
    if LEGACY.is_file() and not TODO_DIR.is_dir():
        TODO_DIR.mkdir(parents=True)
        shutil.copy2(LEGACY, DOCS / "todo.md.bak")
        shutil.move(str(LEGACY), str(TODO_DIR / "personal.md"))
    elif not TODO_DIR.is_dir():
        TODO_DIR.mkdir(parents=True)
        (TODO_DIR / "personal.md").write_text(
            "# Personal\n\n## Now\n\n## Next\n\n## Later\n\n## Done\n", encoding="utf-8")


def _parse(text: str) -> dict:
    sections: dict[str, list] = {s: [] for s in SECTIONS}
    current = None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = m[1] if m[1] in SECTIONS else None
            continue
        if current is None:
            continue
        im = re.match(r"^\s*-\s+\[( |x|X)\]\s?(.*?)\s*$", line)
        if im:
            sections[current].append({"done": im[1].lower() == "x", "text": im[2]})
    return sections


def _header(text: str) -> str:
    out = []
    for line in text.splitlines():
        if re.match(r"^##\s+", line):
            break
        out.append(line)
    return "\n".join(out).rstrip()


def _serialize(header: str, sections: dict) -> str:
    out = header.split("\n") if header else []
    for s in SECTIONS:
        out.extend(["", f"## {s}", ""])
        for it in sections[s]:
            out.append(("- [x] " if it["done"] else "- [ ] ") + it["text"].strip())
    return re.sub(r"\n{3,}", "\n\n", "\n".join(out)).rstrip("\n") + "\n"


def _today() -> str:
    return date.today().isoformat()


def _clean(text: str) -> str:
    return re.sub(r"\s*\[by \d{4}-\d{2}-\d{2}\]", "", text).strip()


def _project_files() -> list[Path]:
    _migrate_if_needed()
    return sorted(p for p in TODO_DIR.glob("*.md") if p.is_file())


def _project_id(p: Path) -> str:
    return p.stem


def _board() -> dict:
    projects = []
    for f in _project_files():
        sections = _parse(f.read_text(encoding="utf-8"))
        pid = _project_id(f)
        projects.append({
            "id": pid,
            "name": (pid.title() if pid == "personal" else pid.replace("-", " ").title()),
            "color": color_of(pid),
            "square": square_of(pid),
            "sections": sections,
            "counts": {s: len(sections[s]) for s in SECTIONS},
            "open": sum(len([i for i in sections[s] if not i["done"]]) for s in ("Now", "Next", "Later")),
        })
    order = {"personal": 0}
    projects.sort(key=lambda p: (order.get(p["id"], 1), p["id"]))
    total_open = sum(p["open"] for p in projects)
    now_open = next((p["counts"]["Now"] for p in projects if p["id"] == "personal"), 0)
    return {"projects": projects, "open": total_open, "now": now_open}


def _path(project: str) -> Path:
    pid = slug(project)
    if pid != project:
        raise HTTPException(400, "bad_project_id")
    f = TODO_DIR / f"{pid}.md"
    if not f.is_file():
        raise HTTPException(404, "unknown_project")
    return f


def _apply_file(f: Path, fn) -> dict:
    text = f.read_text(encoding="utf-8")
    sections = _parse(text)
    if fn(sections) is False:
        raise HTTPException(400, "rejected")
    tmp = f.with_suffix(".md.tmp")
    tmp.write_text(_serialize(_header(text), sections), encoding="utf-8")
    os.replace(tmp, f)
    return _board()


@router.get("/board")
def get_board() -> dict:
    return _board()


@router.get("/todo")
def get_todo_legacy() -> dict:
    """Backward-compatible single-board view (personal) for older clients."""
    b = _board()
    p = next((x for x in b["projects"] if x["id"] == "personal"), None)
    if p is None:
        raise HTTPException(404, "no_personal_board")
    return {"sections": p["sections"], "counts": p["counts"], "open": p["open"],
            "mtime": None, "projects": [x["id"] for x in b["projects"]]}


class Op(BaseModel):
    op: str
    project: str = "personal"
    section: str | None = None
    idx: int | None = None
    text: str | None = None
    to_section: str | None = None
    to_idx: int | None = None


def _sec(sections: dict, name: str | None) -> list:
    if name not in SECTIONS:
        raise HTTPException(400, "bad_section")
    return sections[name]


def _idx(sections: dict, section: str | None, idx: int | None) -> int:
    if idx is None or idx < 0 or idx >= len(_sec(sections, section)):
        raise HTTPException(400, "bad_index")
    return idx


@router.post("/board")
def post_board(op: Op, request: Request) -> dict:
    del request
    _migrate_if_needed()
    pid = slug(op.project)

    if op.op == "create_project":
        name = (op.text or "").strip()[:60]
        if not name:
            raise HTTPException(400, "empty_name")
        f = TODO_DIR / f"{pid}.md"
        if f.exists():
            raise HTTPException(400, "project_exists")
        f.write_text(f"# {name}\n\n## Now\n\n## Next\n\n## Later\n\n## Done\n", encoding="utf-8")
        return _board()

    if op.op == "delete_project":
        if pid == "personal":
            raise HTTPException(400, "cannot_delete_personal")
        f = TODO_DIR / f"{pid}.md"
        if not f.exists():
            raise HTTPException(404, "unknown_project")
        f.unlink()
        return _board()

    f = _path(op.project)

    def mutate(sections: dict):
        if op.op == "add":
            t = (op.text or "").strip()[:MAX_TEXT]
            if not t:
                raise HTTPException(400, "empty_text")
            _sec(sections, op.section).append({"done": False, "text": t})
        elif op.op == "edit":
            i = _idx(sections, op.section, op.idx)
            t = (op.text or "").strip()[:MAX_TEXT]
            if not t:
                raise HTTPException(400, "empty_text")
            sections[op.section][i]["text"] = t
        elif op.op == "complete":
            i = _idx(sections, op.section, op.idx)
            if op.section == "Done":
                item = sections["Done"].pop(i)
                sections["Next"].append({"done": False, "text": _clean(item["text"])})
            else:
                item = sections[op.section].pop(i)
                sections["Done"].append({"done": True, "text": f"{_clean(item['text'])} (completed {_today()})"})
        elif op.op == "move":
            i = _idx(sections, op.section, op.idx)
            item = _sec(sections, op.section).pop(i)
            dst = op.to_idx
            if dst is None or dst > len(_sec(sections, op.to_section)):
                dst = len(_sec(sections, op.to_section))
            if op.section != "Done" and op.to_section == "Done":
                item = {"done": True, "text": f"{_clean(item['text'])} (completed {_today()})"}
            elif op.section == "Done" and op.to_section != "Done":
                item = {"done": False, "text": _clean(item["text"])}
            _sec(sections, op.to_section).insert(dst, item)
        else:
            raise HTTPException(400, "bad_op")

    return _apply_file(f, mutate)
