---
severity: low-medium
impact: polish
comment: "One of four filings of the same memory write bare-stdout observation; consolidate into ux-memory-ls-search-show-raw-unframed.md. Its framing is the fairest of the four: a bare path is genuinely useful for scripting, so the ask is a design-system success on TTY rather than removing the machine-friendly output."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/memory.ts:282-300 write action awaits mem.writePage and returns without any stdout output; no process.stdout/console.log in packages/memory/src (non-test) write paths, so the claimed bare 'hello.md' line is not emitted"
---

# UX: memory write success is bare path on stdout

## Summary

memory write pages/hello.md prints bare hello.md without design-system success panel — inconsistent with memory init panel.

## Evidence

```bash
$ echo hello | poe-code memory write pages/hello.md --reason seed
hello.md
```

## Why it matters

Machine-friendly bare path OK if documented; human path should use design-system.

## Suggested direction

Design-system success for TTY; bare path with --json if needed.

## Severity

Low–Medium

## Area

Memory
