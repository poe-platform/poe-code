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
