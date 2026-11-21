/* Todo board — kanban view over the shared todo.md file. Same list as chat + 7 AM email. */
(function () {
  "use strict";
  const SDK = window.__HERMES_PLUGIN_SDK__;
  const registry = window.__HERMES_PLUGINS__;
  if (!SDK || !registry) return;
  const { React } = SDK;
  const { useState, useEffect, useRef } = SDK.hooks;
  const h = React.createElement;

  const SECTIONS = ["Now", "Next", "Later", "Done"];
  let drag = null; // { section, idx }

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

  function Card_({ item, section, idx, act, setEditing, editing }) {
    const isDone = section === "Done";
    return h("div", {
      className: "todo-card" + (isDone ? " done" : ""),
      draggable: !editing,
      onDragStart: (e) => { drag = { section, idx }; e.dataTransfer.effectAllowed = "move"; },
      onDragEnd: () => { drag = null; },
      onDragOver: (e) => { if (drag) e.preventDefault(); },
      onDrop: (e) => {
        if (!drag) return;
        e.preventDefault(); e.stopPropagation();
        const from = drag; drag = null;
        if (from.section === section && from.idx === idx) return;
        act({ op: "move", section: from.section, idx: from.idx, to_section: section, to_idx: idx });
      },
    },
      h("button", {
        className: "todo-circ",
        title: isDone ? "Reopen (to Next)" : "Complete (to Done)",
        onClick: () => act({ op: "complete", section, idx }),
      }, isDone ? "↩" : "○"),
      editing
        ? h("input", {
            className: "todo-text", defaultValue: item.text, autoFocus: true,
            style: { border: "none", background: "transparent", color: "inherit", font: "inherit", outline: "none" },
            onBlur: (e) => { act({ op: "edit", section, idx, text: e.target.value }); setEditing(null); },
            onKeyDown: (e) => {
              if (e.key === "Enter") { act({ op: "edit", section, idx, text: e.currentTarget.value }); setEditing(null); }
              if (e.key === "Escape") setEditing(null);
            },
          })
        : h("span", {
            className: "todo-text",
            onDoubleClick: () => { if (!isDone) setEditing(`${section}:${idx}`); },
          }, clean(item.text)),
      deadlineChip(item.text));
  }

  function Column({ section, data, act }) {
    const [draft, setDraft] = useState("");
    const [editing, setEditing] = useState(null);
    const items = (data.sections && data.sections[section]) || [];
    const isDone = section === "Done";
    return h("div", {
      className: "todo-col",
      onDragOver: (e) => { if (drag) e.preventDefault(); },
      onDrop: (e) => {
        if (!drag) return;
        e.preventDefault();
        const from = drag; drag = null;
        act({ op: "move", section: from.section, idx: from.idx, to_section: section });
      },
    },
      h("div", { className: "todo-col-head" },
        section,
        h("span", { className: "todo-col-count" }, String(items.length)),
        section === "Now" && items.length > 0 ? h("span", { className: "todo-now-dot" }) : null),
      !isDone && h("input", {
        value: draft, placeholder: `add to ${section.toLowerCase()}…  (Enter)`,
        className: "todo-card", style: { cursor: "text", fontStyle: "normal" },
        onChange: (e) => setDraft(e.currentTarget.value),
        onKeyDown: (e) => {
          if (e.key === "Enter" && draft.trim()) {
            act({ op: "add", section, text: draft.trim() });
            setDraft("");
          }
        },
      }),
      items.length === 0
        ? h("div", { className: "todo-empty" }, "empty")
        : h(React.Fragment, null,
            items.map((it, i) =>
              h(Card_, { key: `${section}:${i}`, item: it, section, idx: i, act, setEditing,
                         editing: editing === `${section}:${i}` }))));
  }

  function TodoPage() {
    const [data, setData] = useState(null);
    const [error, setError] = useState("");
    const [busy, setBusy] = useState(false);
    const busyRef = useRef(false);

    useEffect(() => {
      let alive = true;
      const load = () => api("todo").then((d) => { if (alive && !busyRef.current) setData(d); })
        .catch((e) => { if (alive) setError(String(e && e.message || e)); });
      load();
      const t = setInterval(load, 10000);
      return () => { alive = false; clearInterval(t); };
    }, []);

    const act = (op) => {
      setBusy(true); busyRef.current = true; setError("");
      api("todo", op)
        .then((d) => setData(d))
        .catch((e) => setError(String(e && e.message || e)))
        .finally(() => { setBusy(false); busyRef.current = false; });
    };

    if (error && !data) return h("div", { className: "todo-board" },
      h("div", { className: "todo-error" }, "Todo board failed to load: ", error,
        " — todo.md lives at ~/Documents/todo.md on the server."));
    const counts = (data && data.counts) || {};

    return h("div", { className: "todo-board" },
      h("div", { className: "todo-heading" },
        h("h1", null, "Todo"),
        h("span", { className: "todo-sub" },
          (data ? `${counts.Now || 0} now · ${data.open} open` : "loading…") +
          " · same list as chat and the 7:00 AM email · double-click to edit · drag cards between columns" +
          (busy ? " · saving…" : "")),
        error ? h("span", { className: "todo-sub", style: { color: "var(--color-primary, var(--midground))" } }, error) : null),
      h("div", { className: "todo-layout" },
        SECTIONS.map((s) => h(Column, { key: s, section: s, data: data || { sections: {} }, act }))));
  }

  registry.register("todo-board", TodoPage);
})();
