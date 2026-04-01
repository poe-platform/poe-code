---
agent: claude-code
metric:
  - name: test_count
    script: node scripts/metric-test-count.mjs
    direction: stable
  - name: test_duration
    script: node scripts/metric-test-duration.mjs
    direction: minimize
status:
  state: open
  experiment: 1
  kept: 0
---

# Speed Up Tests

Optimize test suite execution time without removing or skipping tests by improving only one single thing

## Constraints

- Do not remove or skip existing tests
- Do not reduce test coverage
- No parallel execution
