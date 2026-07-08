# UX: superintendent run --help splits into two option sections; [doc] listed as option

## Summary

`superintendent run --help` renders its options in two separate sections — "OPTIONS" (all caps, listing the actual flags) and then a second "Options:" section at the bottom containing only `-v, --verbose`. Additionally, `[doc]` (a positional argument) is listed inside the OPTIONS block as if it were a named flag.

## Evidence

```
OPTIONS
  [doc]                       Path to the superintendent markdown document
  --agent <value>             Override the builder agent for this run.
  ...
  --worktree                  Run in a managed git worktree...

Options: -v, --verbose
```

Two separate sections. `[doc]` has no `--` prefix — it is a positional arg, not an option.

## Why it matters

Users see options in two places and cannot tell which section is authoritative. Listing `[doc]` as an option makes users attempt `--doc <path>` (which fails) instead of passing the path positionally.

## Suggested direction

Merge into a single `Options:` section; move `[doc]` to a separate `Arguments:` section or note it in the Usage line only.

## Severity

High

## Area

Superintendent / run / help / formatting
