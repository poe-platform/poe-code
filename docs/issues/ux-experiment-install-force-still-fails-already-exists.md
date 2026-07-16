---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/experiment.ts:1106 declares '--force Overwrite existing files' but the installSkill call at src/cli/commands/experiment.ts:1225 passes only fs/cwd/homeDir/scope/dryRun and never forwards flags.force; installSkill in packages/agent-skill-config/src/apply.ts accepts no force option (force exists only on unconfigure at apply.ts:90/126) and apply.ts:193-195 throws 'Skill already exists' unconditionally before runMutations, so dry-run and real runs both fail"
comment: "Keep as canonical of the experiment --force trio: the only one recording both dry-run and real runs failing, which rules out a preview-only artefact. Correctly High - a documented flag that cannot do what it says blocks reinstalling or updating the skill entirely. Pair with ux-experiment-install-already-exists-vs-pipeline-skip.md: pipeline's skip-if-exists behavior is the pattern to adopt, so one decision closes both."
---

# UX: experiment install --force still fails Skill already exists

## Summary

experiment install --agent claude --local --force fails Error: Skill already exists even with --force documented on help. Dry-run and real both fail; --force does not overwrite.

## Evidence

```bash
$ poe-code experiment install --agent claude --local --force
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
●  See logs …
# help says: --force Overwrite existing files
```

## Why it matters

--force help lies; users cannot reinstall/update experiment skill.

## Suggested direction

Make --force overwrite; dry-run should show would overwrite.

## Severity

**High**

## Area

Experiment / install
