# UX: --log-dir unwritable may be silently ignored

## Summary

spawn with --log-dir /no/perm/dir still succeeds without warning that logs were not written.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model haiku --log-dir /no/perm/dir
✓ agent: … (success)
$ ls /no/perm/dir → No such file or directory
```

## Why it matters

Users believe logs were captured when they were not.

## Suggested direction

Fail or warn if log-dir cannot be created/written.

## Severity

**High**

## Area

Spawn / logging
