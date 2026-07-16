---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/services/update.ts:32-44 detectPoeCodePackageManager reads only npm_config_user_agent/npm_execpath and falls back to 'npm'; probe with those vars unset printed 'Dry run: would run npm install -g poe-code@latest' while npm_config_user_agent=pnpm/9.0.0 printed 'pnpm add -g', proving detection tracks the invoking runtime, not the install method"
comment: "Contentless twin of ux-update-dry-run-always-global-npm.md; retire. The shared point is fair: update assumes a global npm install regardless of how poe-code was actually installed, so the suggested command is wrong for anyone using bun, pnpm or a local install. Note ux-update-package-manager-override-works.md shows --package-manager exists, so the gap is detection rather than capability."
---

# UX: update always npm install -g

## Summary

Ignores install method.

## Evidence

update --dry-run.

## Why it matters

Wrong upgrade path.

## Suggested direction

Detect install method.

## Severity

Medium

## Area

Update
