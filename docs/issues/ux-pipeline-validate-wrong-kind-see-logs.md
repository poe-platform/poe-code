# UX: pipeline validate wrong kind has See logs

## Summary

pipeline validate on plan kind: Invalid plan YAML: "kind" must be "pipeline" + See logs — kind-aware message good, system chrome residual.

## Evidence

Invalid plan YAML: "kind" must be "pipeline".
●  See logs …

## Why it matters

UserError without logs; suggest plan validate.

## Suggested direction

UserError; Expected pipeline plan, got kind=plan.

## Severity

Medium

## Area

Pipeline
