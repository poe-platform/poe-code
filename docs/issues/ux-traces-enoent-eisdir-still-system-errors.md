---
severity: high
impact: usability
comment: "Keep as canonical of the traces fs-error cluster (covers both ENOENT and EISDIR with repros). Part of the wider bare-throw family (gaslight --config, harness run, memory ingest, skill install, pipeline validate), so fix via the shared path-validation helper rather than per command - ux-mcp-servers-missing-file-almost-good.md proposes exactly that, and traces is the sixth command needing it."
---

# UX: traces missing file/directory still system ENOENT/EISDIR (reconfirmed)

## Summary

traces /tmp/no-such-trace.jsonl → ENOENT…; traces /tmp → EISDIR… + See logs — reconfirm of traces-missing-file and directory path issues.

## Evidence

```bash
$ poe-code traces /tmp/no-such-trace.jsonl
■  Error: ENOENT: no such file or directory, open '…'
$ poe-code traces /tmp
■  Error: EISDIR: illegal operation on a directory, read
```

## Why it matters

Reconfirmed raw fs errors.

## Suggested direction

UserError: Trace file not found / path is a directory.

## Severity

**High**

## Area

Traces
