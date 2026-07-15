---
severity: high
impact: discoverability
comment: "Keep as canonical of the five-file kinds cluster: it has the full working list, the failed guesses, and the sharpest framing - the real kinds are all '-demo' suffixed, so even a user who guesses the right concept ('pipeline') fails, and the names are only discoverable from package tests. High is justified: harness new is the entry point and is unusable without reading source. Fix in three places at once: help choices, the unknown-kind error, and a statement of whether demo kinds are the only kinds."
---

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
