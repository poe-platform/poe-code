---
severity: medium
impact: usability
comment: "Duplicate of ux-skill-install-missing-file-enoent-see-logs.md; retire. Its suggested wording ('Skill file not found') is the right shape for the shared helper."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/skill.ts:155 - bare `await container.fs.readFile(sourcePath, 'utf8')` with no existence check or try/catch, so a missing --file surfaces the raw ENOENT; duplicate of ux-skill-install-missing-file-enoent-see-logs.md"
---

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
