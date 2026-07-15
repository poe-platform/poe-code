---
severity: medium
impact: security
comment: "Keep as canonical of this trio (clearest statement). Legitimate security-adjacent gap: --log-content opts into writing prompts and tool arguments to disk, which routinely contain secrets, and help says nothing about it. The mitigating fact it fairly notes is that the default is off and redacts (ux-spawn-log-default-redacts-agent-message-good.md), making this a warning gap rather than a leak. One line in help plus a one-time runtime notice closes it."
---

# UX: --log-content help has no sensitive-data warning

## Summary

spawn --log-content help only says Include message and tool content in ACP JSONL spawn logs — no warning that prompts/tool args may contain secrets.

## Evidence

--log-content description has no danger/sensitive warning.

## Why it matters

Users may enable content logging in CI and leak secrets to disk.

## Suggested direction

Warn in help; default off (already); optional redaction note.

## Severity

Medium

## Area

Spawn / logging
