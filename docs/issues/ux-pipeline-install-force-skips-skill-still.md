# UX: pipeline install --force overwrites steps but still skips existing skill

## Summary

pipeline install --local --force overwrites steps.yaml but Skip: skill already exists — --force partial; skill never overwritten; success claims Installed skill.

## Evidence

```bash
$ poe-code pipeline install --agent claude-code --local --force
●  Overwrite: .poe-code/pipeline/steps.yaml
●  Skip: .claude/skills/poe-code-pipeline-plan/SKILL.md (already exists)
◆  Installed Pipeline skill…
```

## Why it matters

--force semantics inconsistent; success overclaims skill install.

## Suggested direction

Force overwrites skill too; or success says scaffolded (skill unchanged).

## Severity

**High**

## Area

Pipeline / install
