# UX: memory explain exposes --budget token internals (same as memory query)

## Summary

`poe-code memory explain --help` shows `--budget <tokens>  Token budget` in its Options section — the same LLM infrastructure implementation detail that is already exposed by `memory query`. Neither command shows a default value or valid range.

## Evidence

```
Options:
  --budget <tokens>   Token budget
  --agent <agent>     Agent override
  -h, --help          Display help for command
```

## Why it matters

"Token budget" means nothing to most users. Users who stumble across this flag have no idea what value to pass, whether the default is good, or what breaking it means. Two separate memory commands (query, explain) share this same unexplained flag.

## Suggested direction

Hide `--budget` from user-facing help and use an internal default, or annotate it with a default and range: `Token budget for the LLM response (default: 4096)`.

## Severity

Low

## Area

Memory / explain / help / description quality
