# UX: plan browse non-TTY dumps arbitrary plan body without selection

## Summary

plan browse without TTY dumps full body of some plan (toolcraft human-in-loop…) without path or picker — non-interactive dump of arbitrary content.

## Evidence

```bash
$ poe-code plan browse
# dumps full markdown of some plan in cwd docs
```

## Why it matters

Non-TTY should require path or list; dumping arbitrary plan is surprising.

## Suggested direction

Non-TTY: require path or print plan list only; never dump full body without path.

## Severity

**High**

## Area

Plan / non-TTY
