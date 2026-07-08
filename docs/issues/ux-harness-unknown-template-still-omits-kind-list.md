# UX: harness unknown template still omits valid kind list (reconfirmed)

## Summary

Unknown harness template "notakind" still prints only that message without listing ralph-demo, coverage-demo, experiment-demo, pipeline-demo, superintendent-demo.

## Evidence

```bash
$ poe-code harness new notakind x
■  Unknown harness template "notakind".
```
Kinds from listBuiltinTemplates: ralph-demo, coverage-demo, experiment-demo, pipeline-demo, superintendent-demo.

## Why it matters

Reconfirmed; scaffold command still lacks allow-list in error and help.

## Suggested direction

Error: Expected: …; list kinds in --help argument description.

## Severity

Medium

## Area

Harness
