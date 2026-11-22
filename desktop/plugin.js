/**
 * Hermes desktop plugin: Todo Board — multi-project kanban over ~/Documents/todo/.
 *
 * One markdown file per project (personal.md = the human board); an All tab
 * aggregates every project with color-coded cards. Data flows through the
 * todo-board plugin backend on the gateway host (ctx.rest '/board') — the same
 * list as the dashboard tab, chat, and the morning digest email.
 *
 * Install: %USERPROFILE%\.hermes\desktop-plugins\todo-board\plugin.js (Windows)
 * or ~/.hermes/desktop-plugins/todo-board/plugin.js, then ⌘K → Reload plugins.
 */
import {
  PALETTE_AREA, ROUTES_AREA, SIDEBAR_NAV_AREA,
  cn, haptic, host, useQuery,
  Codicon, Input, ScrollArea, Separator, Tip
} from '@hermes/plugin-sdk'
import { useState } from 'react'
import { jsx, jsxs } from 'react/jsx-runtime'

const SECTIONS = ['Now', 'Next', 'Later', 'Done']
const PALETTE = ['#3b82f6', '#22c55e', '#eab308', '#f97316', '#ef4444', '#a855f7', '#14b8a6', '#ec4899']
const colorOf = (id) => {
  let h = 0
  for (const ch of String(id)) h = (h * 31 + ch.codePointAt(0)) >>> 0
  return PALETTE[h % PALETTE.length]
}

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

let drag = null // { project, section, idx }

function Board({ ctx }) {
  const [tab, setTab] = useState('all')
  const [editing, setEditing] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [newProj, setNewProj] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const q = useQuery({
    queryKey: ['todo-board-desktop', 'board'],
    queryFn: () => ctx.rest('/board'),
    refetchInterval: 10000,
    staleTime: 4000
  })

  const act = (op) => {
    setBusy(true); setErr('')
    ctx.rest('/board', { method: 'POST', body: op })
      .catch((e) => { setErr(String(e && e.message || e)); host.notify({ kind: 'error', message: 'Todo board write failed' }) })
      .finally(() => { setBusy(false); q.refetch() })
  }

  const data = q.data
  const projects = (data && data.projects) || []
  const active = projects.find((p) => p.id === tab)

  if (q.isError && !data) {
    return jsxs('div', { className: 'p-6 text-sm text-(--ui-text-tertiary)', children: [
      'Todo board backend unreachable (it serves /api/plugins/todo-board on the gateway host). ',
      String(q.error && q.error.message || q.error)
    ] })
  }

  const moveItem = (pid, from, to) => {
    if (from.section === to.section && from.idx === to.idx) return
    haptic('tap')
    act({ op: 'move', project: pid, section: from.section, idx: from.idx, to_section: to.section, to_idx: to.idx })
  }

  const Card = ({ it, p, section, idx, showProj }) => {
    const isDone = section === 'Done'
    const edKey = `${p.id}:${section}:${idx}`
    return jsxs('div', {
      draggable: editing !== edKey,
      onDragStart: (e) => { drag = { project: p.id, section, idx }; e.dataTransfer.effectAllowed = 'move' },
      onDragEnd: () => { drag = null },
      onDragOver: (e) => { if (drag && drag.project === p.id) e.preventDefault() },
      onDrop: (e) => {
        if (!drag || drag.project !== p.id) return
        e.preventDefault(); e.stopPropagation()
        const from = drag; drag = null
        moveItem(p.id, from, { section, idx })
      },
      className: cn('cursor-grab rounded-md border px-2 py-1.5 text-[0.8125rem] leading-snug',
        'border-(--ui-stroke-secondary) hover:border-(--ui-accent) active:cursor-grabbing'),
      style: { borderLeft: `3px solid ${p.color}` },
      children: [
        jsxs('div', { className: 'flex items-start gap-1.5', children: [
          jsx('button', {
            type: 'button',
            title: isDone ? 'reopen (to Next)' : 'complete (to Done)',
            className: 'mt-0.5 shrink-0 opacity-60 hover:opacity-100',
            onClick: () => { haptic('tap'); act({ op: 'complete', project: p.id, section, idx }) },
            children: jsx(Codicon, { name: isDone ? 'pass-filled' : 'circle-large-outline' })
          }),
          showProj ? jsx('span', {
            className: 'shrink-0 mt-px text-[0.5625rem] font-bold uppercase tracking-wide',
            style: { color: p.color }, children: p.name
          }) : null,
          editing === edKey
            ? jsx(Input, {
                autoFocus: true, defaultValue: it.text, className: 'h-6 flex-1 text-[0.8125rem]',
                onBlur: (e) => { act({ op: 'edit', project: p.id, section, idx, text: e.target.value }); setEditing(null) },
                onKeyDown: (e) => {
                  if (e.key === 'Enter') { act({ op: 'edit', project: p.id, section, idx, text: e.currentTarget.value }); setEditing(null) }
                  if (e.key === 'Escape') setEditing(null)
                }
              })
            : jsx('span', {
                className: cn('flex-1 break-words', isDone && 'line-through text-(--ui-text-tertiary)'),
                onDoubleClick: () => { if (!isDone) setEditing(edKey) },
                children: cleanText(it.text)
              }),
          jsx(DeadlineChip, { text: it.text })
        ] })
      ]
    })
  }

  const Column = ({ section, cards }) => jsx('div', {
    className: 'flex min-h-0 min-w-0 flex-1 flex-col gap-2',
    onDragOver: (e) => { if (drag) e.preventDefault() },
    onDrop: (e) => {
      if (!drag) return
      e.preventDefault()
      const from = drag; drag = null
      if (active) moveItem(active.id, from, { section, idx: active.sections[section].length })
    },
    children: [
      jsxs('div', { className: 'flex items-center gap-1.5 px-0.5', children: [
        jsx('span', { className: 'text-[0.6875rem] font-semibold tracking-wide uppercase text-(--ui-text-tertiary)', children: section }),
        jsx('span', { className: 'text-[0.6875rem] text-(--ui-text-quaternary)', children: String(cards.length) })
      ] }),
      cards.length === 0
        ? jsx('div', { className: 'rounded-md border border-dashed border-(--ui-stroke-secondary) p-3 text-center text-[0.75rem] text-(--ui-text-quaternary)', children: 'empty' })
        : jsx('div', { className: 'flex flex-col gap-1.5', children: cards })
    ]
  })

  const board = (() => {
    if (tab === 'all') {
      return jsx('div', { className: 'flex min-h-0 flex-1 gap-3', children:
        SECTIONS.map((s) => {
          const cards = []
          for (const p of projects) p.sections[s].forEach((it, i) =>
            cards.push(jsx(Card, { key: `${p.id}:${s}:${i}`, it, p, section: s, idx: i, showProj: true })))
          return jsx(Column, { key: s, section: s, cards })
        })
      })
    }
    if (!active) return null
    return jsx('div', { className: 'flex min-h-0 flex-1 gap-3', children:
      SECTIONS.map((s) => {
        const cards = active.sections[s].map((it, i) =>
          jsx(Card, { key: `${active.id}:${s}:${i}`, it, p: active, section: s, idx: i, showProj: false }))
        const addBox = s !== 'Done' && jsx(Input, {
          value: drafts[`${active.id}:${s}`] || '',
          placeholder: `add to ${s.toLowerCase()}…`,
          className: 'h-7 text-[0.8125rem]',
          onChange: (e) => setDrafts((d) => ({ ...d, [`${active.id}:${s}`]: e.currentTarget.value })),
          onKeyDown: (e) => {
            const k = `${active.id}:${s}`
            const v = (drafts[k] || '').trim()
            if (e.key === 'Enter' && v) { act({ op: 'add', project: active.id, section: s, text: v }); setDrafts((d) => ({ ...d, [k]: '' })) }
          }
        })
        return jsxs(Column, { key: s, section: s, cards: [addBox, ...cards].filter(Boolean) })
      })
    })
  })()

  return jsxs('div', { className: 'flex h-full min-h-0 flex-col gap-3 p-4', children: [
    jsxs('div', { className: 'flex flex-wrap items-baseline gap-x-3', children: [
      jsx('span', { className: 'text-sm font-semibold', children: 'Todo' }),
      jsx('span', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children:
        data ? `${data.now} now · ${data.open} open across ${projects.length} project${projects.length === 1 ? '' : 's'}` : 'loading…' }),
      busy ? jsx('span', { className: 'text-[0.75rem] text-(--ui-text-tertiary)', children: '· saving…' }) : null,
      err ? jsx('span', { className: 'text-[0.75rem]', style: { color: 'var(--ui-accent)' }, children: `· ${err}` }) : null
    ] }),
    jsxs('div', { className: 'flex flex-wrap items-center gap-1.5', children: [
      jsx('button', {
        type: 'button',
        onClick: () => setTab('all'),
        className: cn('rounded-full border px-2.5 py-0.5 text-[0.75rem] transition-colors',
          tab === 'all' ? 'border-(--ui-accent) text-(--ui-accent) font-semibold' : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'),
        children: `All (${data ? data.open : 0})`
      }),
      projects.map((p) => jsx('button', {
        type: 'button',
        onClick: () => setTab(p.id),
        className: cn('inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[0.75rem] transition-colors',
          tab === p.id ? 'font-semibold' : 'border-(--ui-stroke-secondary) text-(--ui-text-tertiary)'),
        style: tab === p.id ? { borderColor: p.color, color: p.color } : undefined,
        children: [jsx('span', { key: 'd', className: 'h-1.5 w-1.5 rounded-full', style: { background: p.color } }), `${p.name} (${p.open})`]
      }, p.id)),
      jsx(Input, {
        value: newProj, placeholder: 'new project…', className: 'h-6 w-36 rounded-full text-[0.75rem]',
        onChange: (e) => setNewProj(e.currentTarget.value),
        onKeyDown: (e) => {
          const v = newProj.trim()
          if (e.key === 'Enter' && v) {
            const id = v.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
            act({ op: 'create_project', project: id, text: v })
            setNewProj(''); setTab(id)
          }
        }
      })
    ] }),
    jsx(Separator, {}),
    board
  ] })
}

function Chip({ ctx }) {
  const q = useQuery({
    queryKey: ['todo-board-desktop', 'chip'],
    queryFn: () => ctx.rest('/board'),
    refetchInterval: 30000,
    staleTime: 10000
  })
  const d = q.data
  return jsx(Tip, {
    label: 'Todo board — one list across desktop, dashboard, chat, and the morning email',
    children: jsxs('button', {
      type: 'button',
      className: 'inline-flex h-full items-center gap-1.5 px-1.5 text-[0.6875rem] text-(--ui-text-tertiary) transition-colors hover:bg-(--chrome-action-hover) hover:text-foreground',
      onClick: () => { haptic('tap'); host.navigate('/todo') },
      children: [
        jsx(Codicon, { name: 'checklist' }),
        d ? `${d.now} now · ${d.open} open` : 'todo'
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
