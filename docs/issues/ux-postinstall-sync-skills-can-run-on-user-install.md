---
severity: medium-high
impact: usability
comment: "Legitimate and well characterised: a postinstall that syncs skills runs on every user install - a classic npm footgun with unexpected filesystem side effects and slower installs. Its own evidence is also the mitigation: CI and SKIP_SYNC_SKILLS already skip it, so the guard exists and the question is whether the default should be opt-in. Its 'never fail install hard' point is the most important line and worth verifying - a postinstall that can fail is worse than one that is merely surprising."
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
