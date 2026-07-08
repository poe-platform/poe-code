# UX: harness new unknown kind does not list templates

## Summary

harness new not-a-kind foo: Unknown harness template "not-a-kind" — no list of valid kinds; harness new --help also omits kinds.

## Evidence

Unknown harness template "not-a-kind".
harness new help: kind = Built-in template kind (no choices).

## Why it matters

Discoverability of templates is broken.

## Suggested direction

List kinds on error and in help (coverage-demo, …).

## Severity

Medium

## Area

Harness
