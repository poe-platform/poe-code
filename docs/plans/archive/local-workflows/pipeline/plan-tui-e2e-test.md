---
kind: pipeline
version: 1
tasks:
  - id: echo-test
    title: Simple echo for TUI dashboard test
    prompt: |
      Run `echo "pipeline-dashboard-ok"` and report the output. Do not change any files.
    status:
      implement: done
---

# Context

Purpose: lightweight fixture for the TUI dashboard end-to-end pipeline test.
