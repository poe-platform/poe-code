# UX: skill install missing --file is raw ENOENT

## Summary

skill install --file /tmp/no-skill.md fails ENOENT: no such file… + See logs.

## Evidence

```bash
$ poe-code skill install claude-code --name x --file /tmp/no-skill.md --yes --local
■  Error: ENOENT: no such file or directory, open '…'
```

## Why it matters

UserError: Skill file not found.

## Suggested direction

ValidationError without logs.

## Severity

Medium

## Area

Skills
