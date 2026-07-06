---
kind: pipeline
version: 1
tasks:
  - id: non-tty-test
    title: Simple echo for non-TTY fallback test
    prompt: |
      Run `echo "non-tty-ok"` and report the output. Do not change any files.
    status:
      implement: done
---

# Context

Purpose: lightweight fixture for the non-TTY fallback verification pipeline test.
