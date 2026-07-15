---
severity: high
impact: correctness
comment: "Valuable and distinct from the 'flag ignored' effort files: it establishes with catalog evidence that xhigh is valid for opus-4.7 but not sonnet-4.6, proving a hard-coded effort value cannot be correct for all models regardless of whether the flag is honoured. Keep as the model-aware-defaults requirement. Key sequencing insight: it survives the sonnet-5 to 4.6 fix, so the constants change will not close it and it needs its own work."
---

# UX: effortLevel xhigh is valid for opus-4.7 but not sonnet-4.6

## Summary

Catalog: opus-4.7 output_effort includes xhigh; sonnet-4.6 does not. configure always writes xhigh regardless of selected model — wrong for sonnet defaults after fix to sonnet-4.6.

## Evidence

opus-4.7: output_effort max, xhigh, high, medium, low, none
sonnet-4.6: max, high, medium, low, none (no xhigh)
configure dry-run always +"effortLevel": "xhigh"

## Why it matters

After sonnet-5→4.6 default fix, still need model-aware effort defaults.

## Suggested direction

Default effort per model catalog; never write unsupported values.

## Severity

**High**

## Area

Configure / models
