/* Todo board — multi-project kanban over ~/Documents/todo/*.md (dashboard plugin). */
(function () {
  "use strict";
  const SDK = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!SDK || !registry) return;
  const { React } = SDK;
  const { useState, useEffect } = SDK.hooks;
  const { Button, Input } = SDK.components;
  const h = React.createElement;

  const SECTIONS = ["Now", "Next", "Later", "Done"];
  let drag = null; // { project, section, idx }

  const api = (path, body) =>
    body === undefined
      ? SDK.fetchJSON(`/api/plugins/todo-board/${path}`)
      : SDK.fetchJSON(`/api/plugins/todo-board/${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });

  function deadlineChip(text) {
    const m = /\[by (\d{4}-\d{2}-\d{2})\]/.exec(text || "");
    if (!m) return null;
    const d = new Date(m[1] + "T12:00:00");
    if (isNaN(d.getTime())) return null;
    const today = new Date(); today.setHours(12, 0, 0, 0);
    const days = Math.round((d - today) / 86400000);
    let label, hot = false;
    if (days < 0) { label = `overdue ${-days}d`; hot = true; }
    else if (days === 0) { label = "DUE TODAY"; hot = true; }
    else if (days === 1) { label = "tomorrow"; hot = true; }
    else if (days <= 3) { label = `${days}d`; }
    else { label = m[1].slice(5); }
    return h("span", { className: "todo-chip" + (hot ? " hot" : "") }, label);
  }

  const clean = (t) => (t || "").replace(/\s*\[by \d{4}-\d{2}-\d{2}\]/g, "").trim();

  function Card_({ item, project, showProject, section, idx, act, setEditing, editing }) {
    const isDone = section === "Done";
    return h("div", {
      className: "todo-card" + (isDone ? " done" : ""),
      style: { borderLeft: `3px solid ${project.color}` },
      draggable: !editing,
      onDragStart: (e) => { drag = { project: project.id, section, idx }; e.dataTransfer.effectAllowed = "move"; },
      onDragEnd: () => { drag = null; },
      onDragOver: (e) => { if (drag) e.preventDefault(); },
      onDrop: (e) => {
        if (!drag) return;
        e.preventDefault(); e.stopPropagation();
        const from = drag; drag = null;
        if (from.project !== project.id) return; // moves stay within a project board
        if (from.section === section && from.idx === idx) return;
        act({ op: "move", project: project.id, section: from.section, idx: from.idx, to_section: section, to_idx: idx });
      },
    },
      h("button", {
        className: "todo-circ",
        title: isDone ? "Reopen (to Next)" : "Complete (to Done)",
        onClick: () => act({ op: "complete", project: project.id, section, idx }),
      }, isDone ? "↩" : "○"),
      showProject ? h("span", { className: "todo-proj-tag", style: { color: project.color } }, project.name) : null,
      editing
        ? h("input", {
            className: "todo-text", defaultValue: item.text, autoFocus: true,
            style: { border: "none", background: "transparent", color: "inherit", font: "inherit", outline: "none" },
            onBlur: (e) => { act({ op: "edit", project: project.id, section, idx, text: e.target.value }); setEditing(null); },
            onKeyDown: (e) => {
              if (e.key === "Enter") { act({ op: "edit", project: project.id, section, idx, text: e.currentTarget.value }); setEditing(null); }
              if (e.key === "Escape") setEditing(null);
            },
          })
        : h("span", {
            className: "todo-text",
            onDoubleClick: () => { if (!isDone) setEditing(`${project.id}:${section}:${idx}`); },
          }, clean(item.text)),
      deadlineChip(item.text));
  }

  function Column({ project, section, items, act, showProject, allowAdd, allowDrop }) {
    const [editing, setEditing] = useState(null);
    const [draft, setDraft] = useState("");
    const isDone = section === "Done";
    return h("div", {
      className: "todo-col",
      onDragOver: (e) => { if (drag && drag.project === project.id) e.preventDefault(); },
      onDrop: (e) => {
        if (!drag || drag.project !== project.id || !allowDrop) return;
        e.preventDefault();
        const from = drag; drag = null;
        act({ op: "move", project: project.id, section: from.section, idx: from.idx, to_section: section });
      },
    },
      h("div", { className: "todo-col-head" },
        section,
        h("span", { className: "todo-col-count" }, String(items.length)),
        section === "Now" && items.length > 0 ? h("span", { className: "todo-now-dot", style: { background: project.color } }) : null),
      allowAdd && !isDone && h("input", {
        value: draft, placeholder: `add to ${section.toLowerCase()}…  (Enter)`,
        className: "todo-card", style: { cursor: "text" },
        onChange: (e) => setDraft(e.currentTarget.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && draft.trim()) {
            act({ op: "add", project: project.id, section, text: draft.trim() });
            setDraft("");
          }
        },
      }),
      items.length === 0
        ? h("div", { className: "todo-empty" }, "empty")
        : h(React.Fragment, null,
            items.map((it, i) =>
              h(Card_, { key: `${section}:${i}`, item: it, project, showProject, section, idx: i, act,
                         setEditing, editing: editing === `${project.id}:${section}:${i}` }))));
  }

  function BoardView({ project, act }) {
    return h("div", { className: "todo-layout" },
      SECTIONS.map((s) =>
        h(Column, { key: s, project, section: s, items: project.sections[s], act, showProject: false, allowAdd: true })));
  }
  function AllBoard({ projects, act }) {
    return h("div", { className: "todo-layout" },
      SECTIONS.map((s) => {
        const cards = [];
        for (const p of projects) for (const it of p.sections[s]) cards.push({ it, p });
        return h("div", { key: s, className: "todo-col" },
          h("div", { className: "todo-col-head" }, s, h("span", { className: "todo-col-count" }, String(cards.length))),
          cards.length === 0
            ? h("div", { className: "todo-empty" }, "empty")
            : h(React.Fragment, null,
                cards.slice(0, 20).map(({ it, p }, i) =>
                  h(Card_, { key: `${p.id}:${s}:${i}`, item: it, project: p, showProject: true,
                              section: s, idx: p.sections[s].indexOf(it), act,
                              setEditing: () => {}, editing: null }))));
      }));
  }

  function ProjectBoard({ project, act }) {
    return h(BoardView, { projects: [project], act, showProject: false, allowAdd: true });
  }

  function TodoPage() {
    const [data, setData] = useState(null);
    const [tab, setTab] = useState("all");
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const [newProj, setNewProj] = useState("");
    const busyRef = { current: false };

    useEffect(() => {
      let alive = true;
      const load = () => api("board").then((d) => { if (alive && !busyRef.current) setData(d); })
        .catch((e) => { if (alive) setError(String(e && e.message || e)); });
      load();
      const t = setInterval(load, 10000);
      return () => { alive = false; clearInterval(t); };
    }, []);

    const act = (op) => {
      setBusy(true); busyRef.current = true; setError("");
      api("board", op).then((d) => setData(d))
        .catch((e) => setError(String(e && e.message || e)))
        .finally(() => { setBusy(false); busyRef.current = false; });
    };

    if (error && !data) return h("div", { className: "todo-board" },
      h("div", { className: "todo-error" }, "Todo board failed to load: ", error));
    const projects = (data && data.projects) || [];
    const active = projects.find((p) => p.id === tab);

    const tabs = [
      h("button", {
        key: "all", className: "todo-tab" + (tab === "all" ? " active" : ""),
        onClick: () => setTab("all"),
      }, `All (${data ? data.open : 0})`),
      ...projects.map((p) =>
        h("button", {
          key: p.id, className: "todo-tab" + (tab === p.id ? " active" : ""),
          onClick: () => setTab(p.id),
          style: tab === p.id ? { borderColor: p.color, color: p.color } : {},
        }, h("span", { className: "todo-tab-dot", style: { background: p.color } }), ` ${p.name} (${p.open})`)),
    ];

    return h("div", { className: "todo-board" },
      h("div", { className: "todo-heading" },
        h("h1", null, "Todo"),
        h("span", { className: "todo-sub" },
          (data ? `${data.now} now · ${data.open} open across ${projects.length} project${projects.length === 1 ? "" : "s"}` : "loading…") +
          " · same list as chat and the morning email · double-click to edit · drag within a project" +
          (busy ? " · saving…" : "")),
        error ? h("span", { className: "todo-sub", style: { color: "var(--color-primary, var(--midground))" } }, error) : null),
      h("div", { className: "todo-tabs" }, tabs,
        h("input", {
          value: newProj, placeholder: "new project…", className: "todo-newproj",
          onChange: (e) => setNewProj(e.currentTarget.value),
          onKeyDown: (e) => {
            const v = newProj.trim();
            if (e.key === "Enter" && v) {
              const id = v.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
              act({ op: "create_project", project: id, text: v });
              setNewProj(""); setTab(id);
            }
          },
        })),
      !data ? h("div", { className: "todo-sub" }, "loading…")
        : tab === "all" ? h(AllBoard, { projects, act })
        : active ? h(ProjectBoard, { project: active, act })
        : h("div", { className: "todo-empty" }, "unknown project"));
  }

  registry.register("todo-board", TodoPage);
})();
