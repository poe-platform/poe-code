---
severity: low
impact: polish
comment: "Keep of this pair and treat it as effectively resolved: bare stdout is correct for a command whose entire output is a path meant for command substitution, and the file concedes it. The only residue is documenting the contract. Its coverage detail is worth keeping - pipeline, experiment and superintendent all behave identically, showing this is a deliberate convention rather than an oversight."
---

# UX: plan-path commands still bare stdout (reconfirmed multi-group)

## Summary

pipeline/experiment/superintendent plan-path print absolute path as bare stdout — good for scripting, inconsistent with panel language unless --json convention documented.

## Evidence

```bash
$ poe-code pipeline plan-path
/Users/…/docs/plans
$ poe-code experiment plan-path
/Users/…/docs/plans
$ poe-code superintendent plan-path
/Users/…/docs/plans
```

## Why it matters

Reconfirmed; document as machine-readable by design.

## Suggested direction

Keep bare path; document; optional --human panel.

## Severity

Low

## Area

Plan path
