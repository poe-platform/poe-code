# UX: gaslight without plan autopicks a plan and hits stale sonnet-5

## Summary

gaslight --yes without plan-path autopicks a plan (e.g. 15-spawn-hooks.md) and fails on dead default model — combines silent selection with Critical model defaults.

## Evidence

```bash
$ poe-code gaslight --yes --mode read
◇  Prompt
│     Implement docs/plans/15-spawn-hooks.md
✓ agent: API Error: 400 Unsupported model: 'claude-sonnet-5'
```

## Why it matters

Non-interactive gaslight should require plan path or list choices; model failure is Critical root cause.

## Suggested direction

Require plan in non-TTY; print selected plan path explicitly; fix model defaults.

## Severity

**High**

## Area

Gaslight
