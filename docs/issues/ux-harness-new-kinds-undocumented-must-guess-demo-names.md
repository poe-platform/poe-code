# UX: harness new kinds are undocumented demo names only

## Summary

harness new kind help says Built-in template kind without listing; common guesses safejs/agent-script/pipeline fail. Actual kinds: ralph-demo, coverage-demo, experiment-demo, pipeline-demo, superintendent-demo — only discoverable from package tests.

## Evidence

```bash
$ poe-code harness new safejs x
■  Unknown harness template "safejs".
# actual: coverage-demo, experiment-demo, pipeline-demo, ralph-demo, superintendent-demo
```

## Why it matters

Users cannot scaffold harnesses without reading source.

## Suggested direction

List kinds in help and unknown-template error; document demos vs production kinds.

## Severity

**High**

## Area

Harness
