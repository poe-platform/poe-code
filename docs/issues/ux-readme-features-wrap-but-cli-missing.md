# UX: README wrap quickstart removed; wrap command still absent (partially resolved)

## Summary

Originally Critical: README led with `wrap` while CLI had no wrap. Concurrent commit `docs(readme): remove wrap quickstart after feature removal` fixed the README. Wrap remains intentionally removed from CLI (`Unknown command: wrap`). Residual risk: external blogs/screenshots/old docs may still advertise wrap.

## Evidence

```bash
$ poe-code wrap
■  Unknown command: wrap
$ rg wrap README.md → no matches (fixed)
```
git: c72cec70d docs(readme): remove wrap quickstart after feature removal

## Why it matters

Highest-traffic docs path is fixed. External references and muscle memory still fail. Root help does not mention removal.

## Suggested direction

Keep wrap removed if intentional. Add migration note in changelog/README FAQ: "wrap removed; use configure + spawn". Consider Did you mean: configure for wrap typo. Close Critical once external docs scanned.

## Severity

Medium


## Area

Docs / CLI sync

## Status note

Partially resolved 2026-07-07 (README). CLI absence intentional.
