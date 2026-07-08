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
