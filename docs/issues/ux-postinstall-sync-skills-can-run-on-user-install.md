---
severity: medium-high
impact: none
reproduced: n
recommendation: no-fix
evidence: "npm pack --dry-run ships only scripts/postinstall-sync-skills.mjs; scripts/sync-skills.ts is absent from package.json files, so postinstall-sync-skills.mjs:25-27 returns skip reason 'missing-sync-script' on user installs. Failures only warn via console.error at postinstall-sync-skills.mjs:68-71 and never fail the install. The lifecycle test scripts/postinstall-sync-skills.lifecycle.test.ts:26-72 exercises a fresh clone that writes sync-skills.ts itself, i.e. dev clones only."
comment: "Legitimate and well characterised: a postinstall that syncs skills runs on every user install - a classic npm footgun with unexpected filesystem side effects and slower installs. Its own evidence is also the mitigation: CI and SKIP_SYNC_SKILLS already skip it, so the guard exists and the question is whether the default should be opt-in. Its 'never fail install hard' point is the most important line and worth verifying - a postinstall that can fail is worse than one that is merely surprising. TRIAGE: not reproduced. sync-skills.ts is not published, so the sync is a no-op skip on real npm installs; it only runs in a dev clone where the script exists. The 'never fail install hard' ask is already satisfied - failures warn and return, never exiting non-zero."
---

# UX: postinstall sync-skills runs on user npm install (side effect)

## Summary

package.json postinstall: node scripts/postinstall-sync-skills.mjs — runs skill sync on every install unless CI/SKIP_SYNC_SKILLS; can surprise users and slow install.

## Evidence

postinstall → scripts/postinstall-sync-skills.mjs (skips CI, SKIP_SYNC_SKILLS).

## Why it matters

Postinstall side effects are a classic npm UX footgun.

## Suggested direction

Document env skips; prefer opt-in; never fail install hard.

## Severity

Medium–High

## Area

Install / postinstall
