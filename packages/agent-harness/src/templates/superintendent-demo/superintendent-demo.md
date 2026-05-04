---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/superintendent-demo.schema.json
kind: superintendent-demo
version: 1
agents:
  builder:
    agent: claude-code
    mode: edit
    prompt: |
      Build the requested change set.
  security:
    agent: claude-code
    mode: read
    prompt: |
      Review for auth, validation, and secret handling issues.
  perf:
    agent: claude-code
    mode: read
    prompt: |
      Review for regressions and obvious inefficiencies.
  tests:
    agent: claude-code
    mode: read
    prompt: |
      Review the test plan and likely gaps.
  judge:
    agent: claude-code
    mode: read
    prompt: |
      Decide whether the builder output is ready for owner review.
  owner:
    agent: claude-code
    mode: read
    prompt: |
      Final approval gate.
max_rounds: 3
---

# Superintendent Demo

Run one builder round, collect specialist reviews, ask the judge for a readiness
decision, and pass that decision to the owner gate.
