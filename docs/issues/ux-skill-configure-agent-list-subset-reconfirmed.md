---
severity: medium
impact: discoverability
comment: "Duplicate of ux-skill-configure-agent-list-differs-from-configure.md with a narrower list (kimi only); retire into it. Its own suggestion resolves itself: ux-skill-configure-kimi-not-supported-clear.md shows kimi already returns 'Skills not supported', so the omission is intentional and the defect is purely that help does not say so."
---

# UX: skill configure agent list subset of configure (reconfirmed)

## Summary

skill configure agents: claude-code, codex, cursor, gemini-cli, opencode, goose — omits kimi (configure includes kimi). Related concurrent skill configure agent list issue.

## Evidence

skill configure: no kimi
configure: includes kimi, kimi-cli

## Why it matters

Reconfirm capability matrix inconsistency for skill vs configure.

## Suggested direction

Align skill-capable agents with skill matrix; message kimi skills unsupported if intentional.

## Severity

Medium

## Area

Skills
