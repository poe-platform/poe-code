# UX audit session status

**Count:** 412 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical 1–9

1. Dry-run diffs print secrets  
2–3. auth api-key reveal (+ dry-run)  
4. Hard-coded dead `claude-sonnet-5` defaults  
5. `--skip-if-configured --yes` rewrote live config to sonnet-5  
6. `--skip-if-configured` help text lies about no-write behavior  
7. spawn poe-agent crash  
8. plan archive/delete --yes arbitrary  
9. logout factory-reset  

## Integrity

Master == disk == 412. Continuously committed on main. Claude model restored to sonnet-4.6 after audit incident.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
