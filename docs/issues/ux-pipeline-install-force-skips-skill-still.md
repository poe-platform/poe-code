---
severity: high
impact: usability
comment: "Duplicate of ux-pipeline-install-force-skips-skill-overwrites-steps.md; retire into it. Its alternative fix is worth carrying: if force is meant to be partial, the success line should say 'scaffolded (skill unchanged)' rather than claiming the skill was installed - the cheaper resolution if the partial behavior is intentional."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:1537 skips skill when skillExists without checking options.force, while steps honor force (line ~1497); success line 1583 still claims 'Installed Pipeline skill'. Duplicate of docs/issues/ux-pipeline-install-force-skips-skill-overwrites-steps.md"
---

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
