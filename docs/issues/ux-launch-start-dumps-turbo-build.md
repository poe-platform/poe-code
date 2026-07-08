# UX: launch start dumps turbo monorepo build before managing process

## Summary

launch start prints full turbo Packages in scope … FULL TURBO before Managed process is running — monorepo build noise leaks into product CLI.

## Evidence

launch start … → turbo 2.9.18 FULL TURBO then ◆ Managed process …

## Why it matters

Product users should never see turbo workspace build.

## Suggested direction

Invoke launcher without turbo; use published binary path.

## Severity

**High**

## Area

Launch / identity
