---
severity: high
impact: usability
comment: "Not a product defect: the turbo build is what npm run dev does by design (predev), so an installed user never sees it - the audit is observing its own harness. Four launch filings report this same noise at High, which materially overstates the backlog. Retire all four into ux-development-mode-usage-intentional-but-leaks.md as dev-UX context. The genuine launch defects (false success, tombstones, blank ids) are independent of it and should not be bundled with turbo output."
---

# UX: launch start dumps turbo monorepo build before managing process

## Summary

launch start prints full turbo Packages in scope … FULL TURBO before Managed process is running — monorepo build noise leaks into product CLI.

## Evidence

launch start … → turbo 2.9.18 FULL TURBO then ◆ Managed process …

## Why it matters

Product users should never see turbo workspace build.

## Suggested direction

Invoke launcher without turbo; use published binary path.

## Severity

**High**

## Area

Launch / identity
