---
severity: medium
impact: polish
reproduced: n
recommendation: no-fix
evidence: "Original claim already fixed: rg -n -i wrap README.md returns no matches (commit c72cec70d); npm run dev -- wrap prints 'Unknown command: wrap' and src/cli/ui/ui.test.ts:107,140-143 assert wrap is absent from help and commands intentionally; residual wrap refs only in low-traffic docs/plans/archive/10-memory.md:103,1115; no CHANGELOG.md exists and no did-you-mean/suggestSimilar in src/"
comment: "Model filing and the only one in the audit that tracks its own resolution: it records the original Critical (README led with a wrap command the CLI lacks), the concurrent commit that fixed the README, the residual risk (external references), and downgrades its own severity accordingly. That discipline is exactly what the reconfirm-heavy clusters lack. Remaining asks are small and sensible: a changelog/FAQ migration note and a did-you-mean for wrap. Its Status note convention is worth adopting across the audit."
---

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
