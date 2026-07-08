# UX: Missing --cwd path is clear message with system chrome

## Summary

spawn -C /missing says Workspace path does not exist (good) but still attaches errors.log system-failure footer.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read -C /tmp/no-such-dir-ux
■  Error: Workspace path "/tmp/no-such-dir-ux" does not exist.
●  See logs …
```

## Why it matters

Message quality good; classification still crash-like. Pattern to standardize for all path errors.

## Suggested direction

ValidationError without errors.log; suggest creating directory or fixing path.

## Severity

Medium

## Area

Spawn / paths
