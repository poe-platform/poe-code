# UX audit session status

**Count:** 376 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical 1–8

1. Dry-run diffs print secrets  
2–3. auth api-key reveal (+ dry-run)  
4. Hard-coded dead `claude-sonnet-5` defaults  
5. `--skip-if-configured --yes` rewrote live config to sonnet-5  
6. spawn poe-agent crash  
7. plan archive/delete --yes arbitrary  
8. logout factory-reset  

## Integrity

Master == disk == 376. Continuously committed on main. Claude model restored to sonnet-4.6 after audit incident.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
