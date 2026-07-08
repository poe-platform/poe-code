# UX: hooks-strategy transform unsupported message is good but system chrome

## Summary

Transforming hooks to claude-code is not supported yet is informative but still Error + See logs; help lists transform as a valid choice so users select it and fail.

## Evidence

```bash
$ poe-code spawn … --hooks-strategy transform --hooks-from claude-code
■  Error: Transforming hooks to "claude-code" is not supported yet; only codex-hook targets can be written
●  See logs …
```
--hooks-strategy choices include transform.

## Why it matters

Help advertises unsupported combinations; failure looks like crash.

## Suggested direction

Filter choices by capability; ValidationError without logs; document supported matrix.

## Severity

**High**

## Area

Hooks / spawn
