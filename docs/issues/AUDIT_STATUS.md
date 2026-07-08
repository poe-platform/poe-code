# UX audit session status

**Count:** 441 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical cluster (sonnet-5)

Only `anthropic/claude-sonnet-5` is dead among FRONTIER_MODELS; opus-4.7, gpt-5.3-codex, gpt-5.4-pro, gemini-3.1-pro resolve. Fix: constants + goose map sonnet-5 → sonnet-4.6.

## Critical 1–N (security + defaults + crash + destructive)

See MASTER top 14.

## Integrity

Master == disk == 441. Continuously committed on main. Claude model restored to sonnet-4.6 after audit incident.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
