# UX: catalog proves opus-4.7 has xhigh; sonnet-4.6 does not (evidence)

## Summary

models --view parameters --model claude-opus-4.7: output_effort enum includes xhigh. sonnet-4.6 parameters only max/high/medium/low/none. configure always plans xhigh regardless — model-aware effort Critical confirmed by catalog.

## Evidence

opus-4.7 output_effort: max, xhigh, high, medium, low, none
sonnet-4.6 output_effort: max, high, medium, low, none (no xhigh)

## Why it matters

Evidence for model-aware effortLevel; xhigh only for opus family.

## Suggested direction

Default effort from catalog per model; never write unsupported effort.

## Severity

**High**

## Area

Config / models
