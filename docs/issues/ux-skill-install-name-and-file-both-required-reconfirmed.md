---
severity: high
impact: usability
comment: "Keep as canonical of this trio (best evidence: both directions tested, proving neither flag can be omitted). Its insight goes beyond error framing and is the valuable one: --name could be derived from the file's basename, so the second required flag is unnecessary rather than merely awkward. That reframes the fix from 'better error' to 'remove the requirement'. Its alternative (a single path argument) is cleaner still."
---

# UX: skill install still requires both --name and --file (reconfirmed)

## Summary

skill install with only --name fails required --file; only --file fails required --name — both required; cannot derive name from path.

## Evidence

```bash
$ poe-code skill install claude --name only-name --yes --local
error: required option '--file <path>' not specified
$ poe-code skill install claude --file /tmp/ux-skill.md --yes --local
error: required option '--name <name>' not specified
```

## Why it matters

Reconfirm footgun; name should default from directory/file stem.

## Suggested direction

Default --name from path basename; or single path arg.

## Severity

**High**

## Area

Skills
