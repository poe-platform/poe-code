# UX: launch start triggers monorepo turbo build noise then opaque failed to start

## Summary

launch start foo -- echo hi (and without --) prints full turbo monorepo build output then Managed process failed to start without stderr of the command — reaffirm launch opaque failure + turbo noise.

## Evidence

```bash
$ poe-code launch start foo -- echo hi
• turbo 2.9.18
  … Packages in scope: … 68 packages …
■  Error: Managed process "foo" failed to start.
```

## Why it matters

Impossible to debug launch; turbo noise looks like product crash.

## Suggested direction

Do not run turbo on launch start; surface command stderr; validate command exists.

## Severity

**High**

## Area

Launch
