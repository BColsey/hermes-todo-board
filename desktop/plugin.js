/**
 * Hermes desktop plugin: Todo Board — kanban pane over the shared todo.md on the backend host.
 *
 * Remote-friendly variant: the data comes from the todo-board plugin backend
 * already deployed on the gateway host (~/.hermes/plugins/todo-board/) via
 * ctx.rest('/todo') — the same list as the web dashboard tab, chat, and the
 * 7:00 AM digest email. No local files are read or written.
 *
 * Install: %USERPROFILE%\.hermes\desktop-plugins\todo-board\plugin.js (Windows)
 * or ~/.hermes/desktop-plugins/todo-board/plugin.js (macOS/Linux), then
 * ⌘K → "Reload desktop plugins".
 *
 * Plain ESM, loaded uncompiled — jsx() calls, not JSX syntax.
 */
import {
  PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA,
  cn, haptic, host, useQuery,
  Codicon, Input, ScrollArea, Separator, Tip
} from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const SECTIONS = ['Now', 'Next', 'Later', 'Done']

// ---------- deadline chip ----------
const parseDeadline = (text) => {
  const m = /\[by (\d{4}-\d{2}-\d{2})\]/.exec(text || '')
  if (!m) return null
  const d = new Date(m[1] + 'T12:00:00')
  if (Number.isNaN(d.getTime())) return null
  const today = new Date(); today.setHours(12, 0, 0, 0)
  return { date: m[1], days: Math.round((d - today) / 86400000) }
}
const cleanText = (text) => (text || '').replace(/\s*\[by \d{4}-\d{2}-\d{2}\]/g, '').trim()

function DeadlineChip({ text }) {
  const dl = parseDeadline(text)
  if (!dl) return null
  let label, hot = false, dim = false
  if (dl.days < 0) { label = `overdue ${-dl.days}d`; hot = true }
  else if (dl.days === 0) { label = 'DUE TODAY'; hot = true }
  else if (dl.days === 1) { label = 'tomorrow'; hot = true }
  else if (dl.days <= 3) { label = `${dl.days}d` }
  else { label = dl.date.slice(5); dim = true }
  return jsx('span', {
    className: cn('shrink-0 rounded px-1 py-px text-[0.625rem] whitespace-nowrap',
      hot ? 'font-semibold' : '', dim ? 'text-(--ui-text-quaternary)' : 'text-(--ui-text-tertiary)'),
    style: hot ? { color: 'var(--ui-accent)', background: 'color-mix(in srgb, var(--ui-accent) 12%, transparent)' } : undefined,
    children: label
  })
}

// ---------- board ----------
let drag = null

function Board({ ctx }) {
  const [editing, setEditing] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const q = useQuery({
    queryKey: ['todo-board-desktop', 'todo'],
    queryFn: () => ctx.rest('/todo'),
    refetchInterval: 10000,
    staleTime: 4000
  })

  const act = (op) => {
    setBusy(true); setErr('')
    ctx.rest('/todo', { method: 'POST', body: op })
      .catch((e) => { setErr(String(e && e.message || e)); host.notify({ kind: 'error', message: 'Todo board write failed' }) })
      .finally(() => { setBusy(false); q.refetch() })
  }

  const data = q.data
  const sections = (data && data.sections) || { Now: [], Next: [], Later: [], Done: [] }

  if (q.isError && !data) {
    return jsxs('div', { className: 'p-6 text-sm text-(--ui-text-tertiary)', children: [
      'Todo board backend unreachable (is the server dashboard/gateway up? it serves /api/plugins/todo-board). ',
      String(q.error && q.error.message || q.error)
    ] })
  }

  const moveItem = (from, to) => {
    if (from.section === to.section && from.idx === to.idx) return
    haptic('tap')
    act({ op: 'move', section: from.section, idx: from.idx, to_section: to.section, to_idx: to.idx })
  }

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col gap-3 p-4', children: [
    jsxs('div', { className: 'flex flex-wrap items-baseline gap-x-3', children: [
      jsx('span', { className: 'text-sm font-semibold', children: 'Todo' }),
      jsx('span', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children:
        data ? `${data.counts.Now} now · ${data.open} open` : 'loading…' }),
      jsx('span', { className: 'text-[0.75rem] text-(--ui-text-quaternary)', children:
        '· one list across desktop, dashboard, chat, and the morning digest email · double-click to edit · drag between columns' }),
      busy ? jsx('span', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: '· saving…' }) : null,
      err ? jsx('span', { className: 'text-[0.75rem]', style: { color: 'var(--ui-accent)' }, children: `· ${err}` }) : null
    ] }),
    jsx(Separator, {}),
    jsxs('div', { className: 'flex min-h-0 flex-1 gap-3', children:
      SECTIONS.map((section) => {
        const items = sections[section] || []
        const isDone = section === 'Done'
        return jsxs('div', {
          className: 'flex min-h-0 min-w-0 flex-1 flex-col gap-2',
          onDragOver: (e) => { if (drag) e.preventDefault() },
          onDrop: (e) => {
            if (!drag) return
            e.preventDefault()
            const from = drag; drag = null
            moveItem(from, { section, idx: items.length })
          },
          children: [
            jsxs('div', { className: 'flex items-center gap-1.5 px-0.5', children: [
              jsx('span', { className: 'text-[0.6875rem] font-semibold tracking-wide uppercase text-(--ui-text-tertiary)', children: section }),
              jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: String(items.length) }),
              (section === 'Now' && items.length > 0)
                ? jsx('span', { className: 'h-1.5 w-1.5 rounded-full', style: { background: 'var(--ui-accent)' } })
                : null
            ] }),
            !isDone && jsx(Input, {
              value: drafts[section] || '',
              placeholder: `add to ${section.toLowerCase()}…`,
              className: 'h-7 text-[0.8125rem]',
              onChange: (e) => setDrafts((d) => ({ ...d, [section]: e.currentTarget.value })),
              onKeyDown: (e) => {
                const v = (drafts[section] || '').trim()
                if (e.key === 'Enter' && v) {
                  act({ op: 'add', section, text: v })
                  setDrafts((d) => ({ ...d, [section]: '' }))
                }
              }
            }),
            jsx(ScrollArea, { className: 'min-h-0 flex-1', children:
              items.length === 0
                ? jsx('div', { className: 'rounded-md border border-dashed border-(--ui-stroke-secondary) p-3 text-center text-[0.75rem] text-(--ui-text-quaternary)', children: 'empty' })
                : jsx('div', { className: 'flex flex-col gap-1.5', children:
                    items.map((it, i) => {
                      const isDoneItem = section === 'Done'
                      const edKey = `${section}:${i}`
                      return jsx('div', {
                        draggable: editing !== edKey,
                        onDragStart: (e) => { drag = { section, idx: i }; e.dataTransfer.effectAllowed = 'move' },
                        onDragEnd: () => { drag = null },
                        onDragOver: (e) => { if (drag) e.preventDefault() },
                        onDrop: (e) => {
                          if (!drag) return
                          e.preventDefault(); e.stopPropagation()
                          const from = drag; drag = null
                          moveItem(from, { section, idx: i })
                        },
                        className: cn('cursor-grab rounded-md border px-2 py-1.5 text-[0.8125rem] leading-snug',
                          'border-(--ui-stroke-secondary) hover:border-(--ui-accent) active:cursor-grabbing'),
                        children: jsxs('div', { className: 'flex items-start gap-1.5', children: [
                          jsx('button', {
                            type: 'button',
                            title: isDoneItem ? 'reopen (to Next)' : 'complete (to Done)',
                            className: 'mt-0.5 shrink-0 opacity-60 hover:opacity-100',
                            onClick: () => { haptic('tap'); act({ op: 'complete', section, idx: i }) },
                            children: jsx(Codicon, { name: isDoneItem ? 'pass-filled' : 'circle-large-outline' })
                          }),
                          editing === edKey
                            ? jsx(Input, {
                                autoFocus: true,
                                defaultValue: it.text,
                                className: 'h-6 flex-1 text-[0.8125rem]',
                                onBlur: (e) => { act({ op: 'edit', section, idx: i, text: e.target.value }); setEditing(null) },
                                onKeyDown: (e) => {
                                  if (e.key === 'Enter') { act({ op: 'edit', section, idx: i, text: e.currentTarget.value }); setEditing(null) }
                                  if (e.key === 'Escape') setEditing(null)
                                }
                              })
                            : jsx('span', {
                                className: cn('flex-1 break-words', isDoneItem && 'line-through text-(--ui-text-tertiary)'),
                                onDoubleClick: () => { if (!isDoneItem) setEditing(edKey) },
                                children: cleanText(it.text)
                              }),
                          jsx(DeadlineChip, { text: it.text })
                        ] })
                      }, edKey)
                    })
                  })
            })
          ]
        }, section)
      })
    })
  ] })
}

// ---------- statusbar chip ----------
function Chip({ ctx }) {
  const q = useQuery({
    queryKey: ['todo-board-desktop', 'chip'],
    queryFn: () => ctx.rest('/todo'),
    refetchInterval: 30000,
    staleTime: 10000
  })
  const d = q.data
  return jsx(Tip, {
    label: 'Todo board — same list as chat and the 7 AM email',
    children: jsxs('button', {
      type: 'button',
      className: 'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => { haptic('tap'); host.navigate('/todo') },
      children: [
        jsx(Codicon, { name: 'checklist' }),
        d ? `${d.counts.Now} now · ${d.open} open` : 'todo'
      ]
    })
  })
}

export default {
  id: 'todo-board',
  name: 'Todo Board',
  register(ctx) {
    ctx.register({
      id: 'page',
      area: ROUTES_AREA,
      data: { path: '/todo' },
      render: () => jsx(Board, { ctx })
    })
    ctx.register({
      id: 'nav',
      area: SIDEBAR_NAV_AREA,
      data: { path: '/todo', label: 'Todo', codicon: 'checklist' }
    })
    ctx.register({
      id: 'open',
      area: PALETTE_AREA,
      data: { id: 'todo-board.open', label: 'Todo: open board', keywords: ['todo', 'tasks', 'kanban', 'board'], run: () => host.navigate('/todo') }
    })
    ctx.register({
      id: 'chip',
      area: 'statusBar.right',
      order: 128,
      render: () => jsx(Chip, { ctx })
    })
  }
}
