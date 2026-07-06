---
agent: claude-code
metric:
  - name: echo_check
    script: echo 42
    direction: stable
baseline:
  echo_check: 42
maxExperiments: 1
---

# TUI Dashboard E2E

Run `echo "experiment-dashboard-ok"` and report the output. Do not change any files.
