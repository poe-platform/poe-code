# UX audit session status

**Count:** 185 · **Master:** [MASTER.md](./MASTER.md)

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

## Catalog notes

- `models --model anthropic/claude-opus-4.7` → 0 hits; bare id works (filter UX bug)  
- `models --search sonnet-5` → 0; sonnet-4.6 exists  
- Other FRONTIER_MODELS exist under search when using bare/search forms  

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
