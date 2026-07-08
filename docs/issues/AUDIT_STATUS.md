# UX audit session status

**Count:** 212 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical 1–8

1. Dry-run diffs print secrets  
2–3. auth api-key reveal (+ dry-run)  
4. Hard-coded dead `claude-sonnet-5` defaults  
5. spawn poe-agent crash  
6. plan archive/delete --yes arbitrary  
7. README wrap missing  
8. logout factory-reset  

## Note

During audit, `configure claude --model sonnet-4.6 --skip-if-configured --yes` performed a real configure write (not dry-run) updating local Claude settings to a live model id.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
