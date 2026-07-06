---
kind: pipeline
version: 1
tasks:
  - id: echo-test
    title: Echo test for TUI dashboard verification
    prompt: |
      Run `echo "pipeline-tui-ok"` and report the output. Do not change any files.
    status:
      implement: done
      test: open
      commit: open
---

# tui verify

Archived local pipeline plan converted from YAML during docs cleanup.
