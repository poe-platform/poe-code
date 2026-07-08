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
