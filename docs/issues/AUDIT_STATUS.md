# UX audit session status

**Count:** 181 · **Master:** [MASTER.md](./MASTER.md)

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

## Verified positive

- `spawn claude --model anthropic/claude-haiku-4.5` succeeds when model is valid  
- `spawn pi` works  
- `@file` and `-` prompt forms work for pi  

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
