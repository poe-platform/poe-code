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
