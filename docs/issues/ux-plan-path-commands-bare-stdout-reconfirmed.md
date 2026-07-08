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
