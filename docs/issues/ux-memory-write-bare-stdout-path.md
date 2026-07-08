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
