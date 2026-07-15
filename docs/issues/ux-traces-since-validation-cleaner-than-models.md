---
severity: high
impact: usability
comment: "Excellent filing and the best kind of comparison in this audit: the same --since concept produces a clean one-line ValidationError in traces and a stack trace plus ERROR log in models, so identical flags have different error quality within one CLI. That makes it an inconsistency to close rather than a behavior to design, and its fix names the mechanism precisely - share parseSinceDuration's error path. Keep and link from ux-models-since-invalid-prints-stack.md, which sees only the bad half."
---

# UX: traces --since invalid is cleaner than models --since (inconsistency)

## Summary

traces --since notaduration returns short Invalid duration for --since without stack; models --since notaduration dumps stack. Same duration concept, different error quality.

## Evidence

```bash
$ poe-code traces --since notaduration
■  Invalid duration for --since: "notaduration".
$ poe-code models --since notaduration
# ERROR log + Stack trace + ■ message
```

## Why it matters

Users see quality vary by command for identical flags.

## Suggested direction

Share parseSinceDuration error path; never stack for ValidationError.

## Severity

**High**

## Area

Errors / consistency
