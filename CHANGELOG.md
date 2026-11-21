# Changelog

All notable changes to this project are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-21

### Added

- Web dashboard half: **Todo** tab (`/todo`) — four-column board (Now / Next / Later / Done) over
  `~/Documents/todo.md`, with add, inline edit, complete/reopen, drag-and-drop between columns,
  and deadline chips (`[by YYYY-MM-DD]`).
- Desktop half: **Todo** page with sidebar navigation and ⌘K palette command, plus a live
  `N now · M open` status-bar chip; all reads/writes go through the gateway plugin API
  (`ctx.rest`), so it works unchanged against a remote backend.
- Backend: `GET`/`POST /api/plugins/todo-board/todo` — parse/serialize round-trip for the
  markdown format, atomic file rewrites, 300-character item cap, fixed sections.
