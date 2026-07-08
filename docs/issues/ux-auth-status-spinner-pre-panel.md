# UX: auth status "Checking authentication..." leaks before panel bracket

## Summary

`auth status` prints "Checking authentication..." at the left edge before (or outside) the panel bracket, not indented like the result content inside the frame. The spinner text is unframed relative to the "Logged in as…" content that follows inside the bracket.

## Evidence

```
% poe-code auth status
  Poe - auth status
[
Checking authentication...
◆  Logged in as Kamil Jopek (@kamil)
[
   Problems? …
```

"Checking authentication..." is at column 0, while "Logged in as…" is indented inside the bracket.

## Why it matters

The progress text leaks outside the design-system panel frame, making the output look unstyled compared to the final result.

## Suggested direction

Either suppress the pre-result progress line (it resolves quickly) or render it inside the panel frame with the same indentation.

## Severity

Medium

## Area

Auth / visual
