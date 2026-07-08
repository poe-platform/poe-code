# UX audit session status

**Count:** 164 · **Master:** [MASTER.md](./MASTER.md)

## Goal

Identify UX issues; maintain master 1–N; keep finding, triaging, prioritizing.

## Critical 1–7

1. Dry-run diffs print secrets  
2–3. auth api-key reveal (+ dry-run)  
4. spawn poe-agent crash  
5. plan archive/delete --yes arbitrary  
6. README wrap missing  
7. logout factory-reset  

## High note

`launch status` can hard-fail on `.state-removed-*` tombstones after normal `launch rm` — ops surface bricked until manual filesystem cleanup.

## Continue

TTY interactive, dashboard, Windows, postinstall, residual edges.
