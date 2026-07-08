# UX: runtime templates parent shows help only twice

## Summary

runtime templates without subcommand prints help twice (Usage block duplicated) instead of defaulting to ls.

## Evidence

runtime templates → help text printed twice with ls/clear commands

## Why it matters

Parent group should default to ls or single help.

## Suggested direction

Default to templates ls; single help frame.

## Severity

Low–Medium

## Area

Runtime
