---
severity: low-medium
impact: polish
comment: "Instance of ux-problems-footer-on-every-success.md; retire into it. Its example is the most pointed in that family and worth quoting: a validation that succeeds ends by asking whether you have problems, which is where the footer's noise becomes self-parody."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/pipeline.ts:1325 logs 'Plan is valid.' then finally calls resources.context.finalize() (line 1372); src/cli/context.ts:69 finalize() unconditionally emits logger.feedback('Problems?', FEEDBACK_URL)"
---

# UX: pipeline validate success still ends with Problems? footer

## Summary

Valid pipeline validation ends with Problems? GitHub link after Plan is valid success.

## Evidence

```bash
$ poe-code pipeline validate …/tiny-http…md
◆  Plan is valid.
└  Problems? https://github.com/…/issues
```

## Why it matters

Reaffirms Problems-on-success for a pure validation success path.

## Suggested direction

Skip Problems footer on successful validate.

## Severity

Low–Medium

## Area

Pipeline
