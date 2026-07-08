# UX: launch logs missing id says No runtime job found

## Summary

launch logs missing: No runtime job found for "missing" + See logs — wrong subsystem name (launch vs runtime jobs); confuses users.

## Evidence

```bash
$ poe-code launch logs missing
■  Error: No runtime job found for "missing".
●  See logs …
```

## Why it matters

Launch process errors should say managed process not runtime job.

## Suggested direction

No managed process found for "missing". Try launch status.

## Severity

**High**

## Area

Launch
