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
