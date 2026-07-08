# UX: usage list --pages exposes auto-pagination implementation detail

## Summary

`poe-code usage list --help` shows:

```
Options:
  --pages <count>   Number of pages to load automatically
```

"Load automatically" describes how the command fetches data internally (paginated API requests), not what the user controls. A user does not think in terms of "pages to load" — they think in terms of how far back in history they want to see.

## Why it matters

The description leaks the implementation. Users are left to guess what a "page" represents (how many records? what time range?). Without a note about what each page contains, the flag is impossible to use meaningfully.

## Suggested direction

Describe in user terms: "Fetch up to N pages of history (default: 1; each page ~100 records)" — or rename to `--limit` if it limits total records.

## Severity

Low

## Area

Usage / list / help / flag description quality
