---
severity: medium
impact: usability
reproduced: y
recommendation: no-fix
evidence: "Confirmed live: `npm run dev -- configure cursor --yes --dry-run` prints only 'Dry run: would configure Cursor.' + '# no filesystem changes'; cause is src/providers/cursor.ts:31 `manifest: { configure: [] }` (zero ops) hitting src/utils/dry-run.ts:160. No-fix as duplicate; canonical is ux-configure-cursor-dry-run-no-filesystem-changes.md"
comment: "Duplicate of ux-configure-cursor-dry-run-no-filesystem-changes.md; retire into it. Carry over its one memorable contribution: cursor is the exact opposite failure mode from codex - one dry-run shows nothing, the other shows everything - and both miss the same target, an intentional-only plan. That pairing is the right framing for fixing dry-run once across agents."
---

# UX: configure cursor --dry-run is nearly empty (like gemini)

## Summary

configure cursor and cursor-agent --yes --dry-run only print would configure Cursor / # no filesystem changes with no model/provider/files plan.

## Evidence

```bash
$ poe-code configure cursor --yes --dry-run
●  Dry run: would configure Cursor.
●  # no filesystem changes
```

## Why it matters

Dry-run useless for review; opposite of codex flood.

## Suggested direction

Print intended files/settings even if no-op; explain why no changes.

## Severity

Medium

## Area

Dry-run
