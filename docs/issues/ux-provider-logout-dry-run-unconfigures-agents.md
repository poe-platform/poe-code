---
severity: high
impact: correctness
comment: "Same scope defect as the login side (ux-provider-login-poe-dry-run-rewrites-claude-settings-xhigh.md): logging out of a provider walks agent unconfigure rather than touching credentials only. Correctly High, and the anthropic contrast (ux-provider-logout-anthropic-dry-run-good.md) proves it is poe-specific. Consolidate the login and logout scope filings into one issue: provider credential operations must not reconfigure agents. That also shrinks the logout secret leak, since the secrets appear in the agent diffs it should not be producing."
---

# UX: provider logout --dry-run floods agent diffs

## Summary

provider logout dry-run walks agent unconfigure not just credentials.

## Evidence

provider logout poe --dry-run.

## Why it matters

Blast radius unclear.

## Suggested direction

Summary first; redact secrets.

## Severity

**High**

## Area

Provider / dry-run
