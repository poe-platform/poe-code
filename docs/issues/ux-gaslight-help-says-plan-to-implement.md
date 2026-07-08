# UX: gaslight help says plan-path is Markdown plan to implement

## Summary

gaslight --help Argument plan-path: Markdown plan to implement — hard-codes Implement intent in help; default prompt is Implement path (critical mutation class).

## Evidence

```text
Arguments:
  plan-path           Markdown plan to implement
```
Default gaslight prompt is Implement <path>.

## Why it matters

Help copy steers toward destructive Implement; conflicts with --mode read safety.

## Suggested direction

Markdown plan to run; default prompt Review/implement only with --implement or yolo.

## Severity

**High**

## Area

Gaslight / help
