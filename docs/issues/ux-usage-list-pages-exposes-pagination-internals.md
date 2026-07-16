---
severity: low
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/usage.ts:187 option text 'Number of pages to load automatically'; page size hardcoded as limit=20 at src/cli/commands/usage.ts:285 and never shown in help"
comment: "Careful and correct: '--pages <count> Number of pages to load automatically' describes the fetch mechanism rather than the user's intent, and a page has no documented size so the flag cannot be reasoned about. Consolidate with ux-usage-pages-1-still-shows-20-entries.md, which supplies the missing number (20 per page). Its rename suggestion is the better fix - --limit expresses what users want and matches traces."
---

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
