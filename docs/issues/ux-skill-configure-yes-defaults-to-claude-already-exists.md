---
severity: medium
impact: usability
comment: "Duplicate within the skill configure silent-default trio, though it usefully shows the two defects compounding: the silent default picks claude and then fails on already-exists, so the user gets an error about a target they never chose. Retire into ux-skill-configure-exists-system-chrome.md (the exists half) and the silent-defaults rule (the default half)."
---

# UX: skill configure --yes without agent defaults to claude and fails already exists

## Summary

skill configure --yes without agent targets claude-code and fails Skill already exists … See logs — silent default + no --force.

## Evidence

```bash
$ poe-code skill configure --yes
■  Error: Skill already exists: …/poe-generate.md
```

## Why it matters

Silent default agent + no overwrite policy.

## Suggested direction

Require agent non-TTY; --force; UserError.

## Severity

Medium

## Area

Skills
