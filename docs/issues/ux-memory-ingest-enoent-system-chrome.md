---
severity: medium
impact: usability
comment: "Another instance of the bare-throw ENOENT family (with gaslight --config, harness run, traces); retire into the shared path-validation issue rather than fixing per command - ux-mcp-servers-missing-file-almost-good.md proposes exactly that helper. Its suggested wording is the best of the family because it names both accepted input types: 'Source not found: path. Provide file or URL.'"
reproduced: y
recommendation: fix
evidence: "packages/memory/src/ingest.ts:152 bare fs.readFile(source.absPath) throws raw ENOENT; src/cli/commands/memory.ts:153-168 resolveIngestSource never checks existence; src/cli/bootstrap.ts:71-77 prefixes 'Error:' and appends 'See logs' for non-CliError throws"
---

# UX: memory ingest missing file is ENOENT system chrome

## Summary

memory ingest /tmp/no-such-file: ENOENT open path + See logs — should be ValidationError source not found.

## Evidence

■  Error: ENOENT: no such file or directory, open '/tmp/no-such-file'
●  See logs …

## Why it matters

UserError without logs.

## Suggested direction

Source not found: path. Provide file or URL.

## Severity

Medium

## Area

Memory
