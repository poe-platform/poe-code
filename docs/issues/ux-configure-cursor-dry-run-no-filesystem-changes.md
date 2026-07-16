---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/providers/cursor.ts:31 manifest: { configure: [] } means zero fs ops, so src/utils/dry-run.ts:160 prints '# no filesystem changes'; confirmed by `npm run dev -- configure cursor --yes --dry-run` output: 'Dry run: would configure Cursor.' + '# no filesystem changes'"
comment: "Keep as canonical of the cursor dry-run opacity trio - clearest framing of the user-facing gap. State the unanswered question in the issue: does cursor configure genuinely write nothing (then say 'registry/env only, no files') or does it write something the dry-run fails to render? ux-configure-cursor-model-flag-silent-noop.md hints at the latter, and the answer changes the fix."
---

# UX: configure cursor --dry-run says no filesystem changes (opaque)

## Summary

configure cursor --yes --dry-run: would configure Cursor; # no filesystem changes — success without showing what configure means for cursor (env-only?).

## Evidence

Dry run: would configure Cursor. # no filesystem changes

## Why it matters

Users cannot tell what cursor configure does.

## Suggested direction

Explain: updates poe-code registry only / env instructions.

## Severity

Medium

## Area

Configure / cursor
