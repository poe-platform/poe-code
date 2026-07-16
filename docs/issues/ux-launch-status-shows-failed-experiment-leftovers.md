---
severity: low-medium
impact: polish
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/launch.ts:135-159 renders every record with no status filter, prune, --stale flag or rm hint, and launcher.ts:272-288 lists all ids with no GC, so stopped rows persist unhinted; but live 'npm run dev -- launch status' errors on a .state-removed-foo tombstone instead of showing rows, per canonical ux-launch-status-crashes-on-tombstone-dirs.md"
comment: "Contentless fourth filing of the ghost-rows observation; retire into the consolidated blank-ID issue. Its 'suggest rm' idea is moot given ux-launch-status-crashes-on-tombstone-dirs.md shows rm is what creates the breakage. Verified residue is only the missing cleanup hint (polish), since retaining stopped specs is deliberate docker-ps-a-style design and rm does clear rows (state-store.ts:159 skips tombstones); the real listing defect is the tombstone crash tracked canonically."
---

# UX: launch status ghost processes

## Summary

stopped leftovers no cleanup hint.

## Evidence

launch status myproc.

## Why it matters

Ghost records.

## Suggested direction

Suggest rm.

## Severity

Low–Medium

## Area

Launch
