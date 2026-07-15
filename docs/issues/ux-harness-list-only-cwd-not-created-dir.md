---
severity: medium
impact: usability
comment: "Keep as canonical of this pair - it shows the actual consequence: harness new reports success at /tmp/h4 and harness list immediately answers 'No harness pairs found', so the product denies the existence of what it just created. That reads as a failed creation and is worse than the missing flag it stems from; understated at Medium. Fix: --dir on list/run discovery plus a next-step line printed by new."
---

# UX: harness list only scans cwd; newly created --dir harnesses invisible

## Summary

harness new … --dir /tmp/h4 creates pair successfully; harness list still says No harness pairs found because it only scans current project, not the --dir path just used.

## Evidence

```bash
$ poe-code harness new pipeline-demo demo4 --dir /tmp/h4 --yes
◆  Created harness pair at /tmp/h4
$ poe-code harness list
●  No harness pairs found.
```

## Why it matters

Users think creation failed; list scope undocumented.

## Suggested direction

Document list search paths; list --dir; print next: harness run /tmp/h4/demo4.md.

## Severity

Medium

## Area

Harness
