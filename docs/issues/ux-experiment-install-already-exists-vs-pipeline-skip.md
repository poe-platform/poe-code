---
severity: high
impact: usability
comment: "Excellent filing, correctly High: it proves two installers in the same product disagree about idempotency - experiment hard-errors on an existing skill while pipeline skips with an info line - making this an inconsistency to resolve rather than a behavior to invent, with the preferred pattern already shipping. Keep as canonical for installer idempotency; it absorbs the experiment --force filings, since 'exists' should never be a system error. Ties to the rule in ux-config-init-already-exists-good.md: already-exists is idempotent success."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/experiment.ts:1226 calls installSkill unconditionally, so packages/agent-skill-config/src/apply.ts:194 throws 'Skill already exists'; src/cli/commands/pipeline.ts:1537-1540 guards with skillExists and logs 'Skip: ... (already exists)' instead"
---

# UX: experiment install errors on existing skill; pipeline install skips (inconsistent)

## Summary

experiment install when skill exists hard-errors Skill already exists; pipeline install --dry-run skips existing skill and reports would install. Same class of installers, different idempotency.

## Evidence

```bash
$ poe-code experiment install --agent claude-code --local
■  Error: Skill already exists: .claude/skills/poe-code-experiment-plan/SKILL.md
$ poe-code pipeline install --agent claude-code --local --dry-run
●  Skip: …/poe-code-pipeline-plan/SKILL.md (already exists)
●  Would install Pipeline skill…
```

## Why it matters

Idempotent installs should skip or --force consistently across installers.

## Suggested direction

Standardize: skip-if-exists (info) or require --force; never system-error for exists.

## Severity

**High**

## Area

Install / consistency
