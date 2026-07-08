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
