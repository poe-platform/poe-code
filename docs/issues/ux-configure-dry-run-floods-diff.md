---
severity: medium
impact: usability
comment: "Contentless ('Huge settings diffs.', '163 lines.') and fully covered by ux-configure-dry-run-dumps-entire-existing-agent-config.md; retire. The 163-line figure is its only concrete detail and is worth quoting in the survivor as the scale of the flood."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- configure --yes --dry-run emitted 340 lines, a full-file settings.json diff including unrelated enabledPlugins/extraKnownMarketplaces; src/utils/dry-run.ts:308 renderUnifiedDiff prints whole content. Duplicate of ux-configure-dry-run-dumps-entire-existing-agent-config.md"
---

# UX: configure --dry-run floods diffs

## Summary

Huge settings diffs.

## Evidence

configure --yes --dry-run 163 lines.

## Why it matters

Unreadable preview.

## Suggested direction

Short plan; verbose full.

## Severity

Medium

## Area

Dry-run
