# UX audit session status

**Count:** 353 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical (updated)

1. Dry-run diffs print secrets  
2–3. auth api-key reveal (+ dry-run) — reconfirmed  
4. Hard-coded dead `claude-sonnet-5` defaults  
5. **`--skip-if-configured --yes` rewrote live config to sonnet-5** (audit incident; restored to sonnet-4.6)  
6. spawn poe-agent crash  
7. plan archive/delete --yes arbitrary  
8. logout factory-reset  

## Integrity

Master == disk == 353. Continuously committed on main.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
