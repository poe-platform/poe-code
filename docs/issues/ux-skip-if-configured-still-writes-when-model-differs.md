---
severity: medium
impact: correctness
comment: "The most thoughtful file in the skip cluster and the one that questions the premise: when --model differs from stored config, writing is arguably correct - 'already configured' plausibly means matching, not merely present. So the real defect here is that the match criteria are undefined, which is why the rest of the cluster disagrees about what the flag should do. Its ask is right and should shape the fix: document the criteria (file hash? model? provider?) and print 'would skip' versus 'would update' with the reason. Keep as the semantics question alongside the Critical."
---

# UX: configure --skip-if-configured still writes when --model differs

## Summary

Passing --skip-if-configured with an explicit --model that differs from stored config still runs a full configure write (not a skip), despite the flag name suggesting no-op when already configured. Observed live: configured Claude Code with sonnet-4.6 rather than skipping.

## Evidence

```bash
$ poe-code configure claude --model anthropic/claude-sonnet-4.6 --skip-if-configured --yes
◇  Claude Code default model
│     anthropic/claude-sonnet-4.6
◆  Configured Claude Code.
# not "already configured" skip
```

## Why it matters

Flag semantics unclear: skip if any config exists vs skip if exact match including model. Users may expect no write.

## Suggested direction

Document match criteria (files hash vs model/provider); print would skip vs would update reasons.

## Severity

Medium

## Area

Configure
