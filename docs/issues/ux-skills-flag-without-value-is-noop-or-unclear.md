# UX: --skills without value appears accepted as no-op

## Summary

spawn … --skills with no value still runs the agent successfully (boolean presence?) without error or warning that no skills were bridged.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --skills
# succeeds without skill bridge message
```

## Why it matters

Optional flag with missing value should error or warn; silent no-op confuses.

## Suggested direction

Require value for --skills; error if empty list when flag present.

## Severity

Medium

## Area

Spawn / skills
