---
severity: medium
impact: usability
comment: "Fair and well observed: 'Nothing to run' followed by 'Pipeline run finished' plus the Problems footer reads as success when no work occurred, and there is no path forward (re-open tasks, archive). The 21/21 done line is the genuinely useful information and it is buried. Its fix is right: make it an informational outcome with next steps. The Problems-footer half belongs to ux-problems-footer-on-every-success.md."
---

# UX: pipeline Nothing to run uses success framing with Problems footer

## Summary

pipeline run on fully done plan prints Nothing to run, Pipeline run finished success, and Problems? footer — looks like success when nothing happened; no next steps for re-run/reset.

## Evidence

```bash
$ poe-code pipeline run --plan …/tiny-http… --max-runs 1 --yes
◇  Tasks
│     21/21 done
●  Nothing to run.
◆  Pipeline run finished.
└  Problems? …
```

## Why it matters

Empty success confuses; should be info exit with how to re-open tasks.

## Suggested direction

Info status: all tasks complete; suggest archive or reopen; skip Problems footer.

## Severity

Medium

## Area

Pipeline
