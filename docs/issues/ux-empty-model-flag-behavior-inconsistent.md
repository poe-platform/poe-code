# UX: Empty --model behavior differs across agent/spawn/configure

## Summary

--model "" on agent fails with Missing model (good-ish); on spawn falls through to stale configured model and 400; on configure dry-run ignores empty and still plans default stale model write.

## Evidence

```bash
$ poe-code agent "hi" --model ""
■  Error: Missing model. Provide a non-empty model…
$ poe-code spawn claude "hi" --mode read --model ""
✓ agent: API Error: 400 Unsupported model: 'claude-sonnet-5'
$ poe-code configure claude --model "" --yes --dry-run
●  Dry run: would configure Claude Code.  # still writes default model
```

## Why it matters

Explicit empty flags must not silently fall back to broken defaults inconsistently.

## Suggested direction

Reject empty --model everywhere as ValidationError; never fall back when flag present.

## Severity

**High**

## Area

Models / flags
