# UX: spawn -i without TTY dumps raw agent --print error

## Summary

Interactive spawn without prompt/TTY surfaces raw agent-native --print error outside design system.

## Evidence

spawn claude --mode read -i → Error: Input must be provided… when using --print.

## Why it matters

Users asked for -i; error mentions --print they never passed.

## Suggested direction

Validate -i requires TTY; product language.

## Severity

**High**

## Area

Spawn / interactive
