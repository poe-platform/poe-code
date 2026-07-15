---
severity: high
impact: usability
comment: "The sharpest of the four 'refuse to replace' filings and the one to keep: the others report symlink and project scope hitting the refusal, which is arguably correct safety, but this shows auto hits it too - and auto is the strategy whose name promises it will choose a working path. That makes it a real defect rather than a recovery-copy gap. Fix: auto should merge or skip with a warning and never hard-fail. The three siblings then reduce to documentation."
---

# UX: --hooks-strategy auto still refuses user-authored settings

## Summary

--hooks-from claude-code --hooks-strategy auto fails same Refuse to replace user-authored hook file — auto does not fall back to a non-destructive path.

## Evidence

```bash
$ poe-code spawn … --hooks-from claude-code --hooks-strategy auto
■  Error: Refuse to replace user-authored hook file at …/.claude/settings.json
```

## Why it matters

auto strategy name implies it would choose a working path.

## Suggested direction

auto should merge or skip with warning, not hard-fail like symlink.

## Severity

**High**

## Area

Hooks / spawn
