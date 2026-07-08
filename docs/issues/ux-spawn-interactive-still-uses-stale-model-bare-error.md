# UX: spawn -i with prompt still hits stale model as bare API error

## Summary

Even with prompt and -i, non-TTY spawn can surface bare API Error: 400 Unsupported model without design-system panel when configured model is stale.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read -i
API Error: 400 Unsupported model: 'claude-sonnet-5'.
```

## Why it matters

Interactive flag + prompt should not yield unframed API string; stacks with stale model and -i issues.

## Suggested direction

Design-system error; preflight model; refuse -i without TTY with clear message first.

## Severity

**High**

## Area

Spawn / interactive
