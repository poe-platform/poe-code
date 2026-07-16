---
severity: high
impact: correctness
reproduced: y
recommendation: fix
evidence: "Confirmed GC bug, independent of malformed-id cause. state-store.ts:204 remove() renames processDir to .state-removed-<id>-<uuid> inside the same baseDir then swallows cleanup errors via .catch(() => undefined); cleanup always fails because launcher.ts defaultFs() defines no rmdir, so state-store.ts:68 calls fs.rm(dir, {force: true}) without recursive, which Node throws ERR_FS_EISDIR for (verified: 'rm(dir,{force:true}) THREW: ERR_FS_EISDIR'). Leftover residue is then listed because launcher.ts listIds (804-813) lacks the .state-removed- filter that stateStore.list has at state-store.ts:159. Probe against real removeManagedProcess: after rm, baseDir still contains .state-removed-ghost-b292f3a8-...; listManagedProcesses on residue dirs lacking spec/state returned 2 records rendering 'ID=[-] STATUS=[stopped] RUNTIME=[host]' via formatStatusRow (launch.ts:615,622), matching the report. When residue retains spec.json, status hard-throws 'Invalid managed process specification' (launcher.ts:842) instead, so rm silently breaks its documented contract to remove state and logs."
comment: "Duplicate within the blank-ID cluster; retire. Its one distinct claim is worth verifying rather than assuming: that rows persist after launch rm, which would make this a GC bug independent of the malformed-id cause suspected in ux-launch-start-via-npm-run-dev-confuses-argv.md. Test that exact sequence with the installed binary."
---

# UX: launch status shows blank ID "-" zombie rows after rm

## Summary

After launch rm, status still lists rows with ID - STATUS stopped — registry not cleaned; table fills with ghosts.

## Evidence

launch status after rm → multiple rows with ID "-" stopped.

## Why it matters

Unusable process table; looks broken.

## Suggested direction

Prune blank-id entries; hide stopped blank rows by default.

## Severity

**High**

## Area

Launch
