---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/pipeline.ts:1508 gates steps.yaml on options.force, but :1537 `if (skillExists)` skips the skill unconditionally; :1583 still reports 'Installed Pipeline skill'"
comment: "Keep as canonical of this pair. The finding is sharper than 'inconsistent force': within one command --force overwrites steps.yaml and skips the skill, so the flag is partial and the success line then claims the skill was installed - three defects compounding (partial force, silent skip, false success). Read with ux-experiment-install-force-still-fails-already-exists.md (where --force refuses entirely) and ux-install-skill-flags-inconsistent-across-commands.md: the installers disagree on force semantics as well as flag names. One policy decision covers all."
---

# UX: pipeline install --force overwrites steps.yaml but skips skill

## Summary

pipeline install --agent claude --local --force: Overwrite steps.yaml; Skip skill already exists — --force partial; skill never updated; steps scaffold force-written without dry-run default.

## Evidence

```bash
$ poe-code pipeline install --agent claude --local --force --yes
●  Overwrite: .poe-code/pipeline/steps.yaml
●  Skip: .claude/skills/poe-code-pipeline-plan/SKILL.md (already exists)
```

## Why it matters

Inconsistent --force semantics across installers (experiment vs pipeline).

## Suggested direction

Unified force policy: overwrite skill+scaffold or document partial; --dry-run.

## Severity

**High**

## Area

Pipeline / install
