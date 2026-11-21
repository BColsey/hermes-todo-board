"""Todo board dashboard API — read/write ~/Documents/todo.md.

The same file the morning digest cron job emails and the
todo-list skill edits from chat; this router is the third door (the web
dashboard board at /todo). Auth is supplied by the dashboard host.
"""

from __future__ import annotations

import os
import re
from datetime import date
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

router = APIRouter()

TODO = Path.home() / "Documents" / "todo.md"
SECTIONS = ["Now", "Next", "Later", "Done"]
MAX_TEXT = 300


def _parse(text: str) -> dict:
    sections: dict[str, list] = {s: [] for s in SECTIONS}
    current = None
    for line in text.splitlines():
        m = re.match(r"^##\s+(.+?)\s*$", line)
        if m:
            current = m.group(1) if m.group(1) in SECTIONS else None
            continue
        if current is None:
            continue
        im = re.match(r"^\s*-\s+\[( |x|X)\]\s?(.*?)\s*$", line)
        if im:
            sections[current].append({"done": im.group(1).lower() == "x", "text": im.group(2)})
    return sections


def _header(text: str) -> str:
    out = []
    current = False
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


def _payload() -> dict:
    text = TODO.read_text(encoding="utf-8")
    sections = _parse(text)
    return {
        "sections": sections,
        "counts": {s: len(sections[s]) for s in SECTIONS},
        "open": sum(len([i for i in sections[s] if not i["done"]]) for s in ("Now", "Next", "Later")),
        "mtime": TODO.stat().st_mtime,
    }


@router.get("/todo")
def get_todo() -> dict:
    if not TODO.is_file():
        raise HTTPException(404, "todo_md_missing")
    return _payload()


class Op(BaseModel):
    op: str
    section: str | None = None
    idx: int | None = None
    text: str | None = None
    to_section: str | None = None
    to_idx: int | None = None


def _apply(op: Op) -> dict:
    text = TODO.read_text(encoding="utf-8")
    sections = _parse(text)
    header = _header(text)

    def sec(name: str | None) -> list:
        if name not in SECTIONS:
            raise HTTPException(400, "bad_section")
        return sections[name]

    def index(name: str | None, idx: int | None) -> int:
        if idx is None or idx < 0 or idx >= len(sec(name)):
            raise HTTPException(400, "bad_index")
        return idx

    if op.op == "add":
        t = (op.text or "").strip()[:MAX_TEXT]
        if not t:
            raise HTTPException(400, "empty_text")
        sec(op.section).append({"done": False, "text": t})
    elif op.op == "edit":
        i = index(op.section, op.idx)
        t = (op.text or "").strip()[:MAX_TEXT]
        if not t:
            raise HTTPException(400, "empty_text")
        sec(op.section)[i]["text"] = t
    elif op.op == "complete":
        i = index(op.section, op.idx)
        if op.section == "Done":
            item = sec("Done").pop(i)
            sec("Next").append({"done": False, "text": _clean(item["text"])})
        else:
            item = sec(op.section).pop(i)
            sec("Done").append({"done": True, "text": f"{_clean(item['text'])} (completed {_today()})"})
    elif op.op == "move":
        i = index(op.section, op.idx)
        item = sec(op.section).pop(i)
        dst = op.to_idx
        if dst is None or dst > len(sec(op.to_section)):
            dst = len(sec(op.to_section))
        if op.section != "Done" and op.to_section == "Done":
            item = {"done": True, "text": f"{_clean(item['text'])} (completed {_today()})"}
        elif op.section == "Done" and op.to_section != "Done":
            item = {"done": False, "text": _clean(item["text"])}
        sec(op.to_section).insert(dst, item)
    elif op.op == "reload":
        pass  # no-op write cycle: normalize the file
    else:
        raise HTTPException(400, "bad_op")

    tmp = TODO.with_name("todo.md.tmp")
    tmp.write_text(_serialize(header, sections), encoding="utf-8")
    os.replace(tmp, TODO)
    return _payload()


@router.post("/todo")
def post_todo(op: Op, request: Request) -> dict:
    del request
    if not TODO.is_file():
        raise HTTPException(404, "todo_md_missing")
    return _apply(op)
