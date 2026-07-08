# UX: spawn invalid model shows success glyphs then failure

## Summary

spawn with --model does-not-exist-xyz prints ✓ agent: API Error: 400 Unsupported model and ✓ tokens then Error: Claude Code spawn failed — success markers on failure.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model does-not-exist-xyz
✓ agent: API Error: 400 Unsupported model: 'does-not-exist-xyz'.
✓ tokens: 0 in → 0 out
■  Error: Claude Code spawn failed with exit code 1
```

## Why it matters

Success glyphs on failure confuse users and break log scanners.

## Suggested direction

No ✓ on failed spawn; validate model before spawn when possible; UserError.

## Severity

**High**

## Area

Spawn / errors
