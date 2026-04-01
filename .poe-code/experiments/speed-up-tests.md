---
agent: claude-code
metric:
  - name: test_count
    script: node scripts/metric-test-count.mjs
    direction: stable
  - name: test_duration
    script: node scripts/metric-test-duration.mjs
    direction: minimize
baseline:
  test_count: 2725
  test_duration: 23447.85009765625
status:
  state: open
  experiment: 2
  kept: 1
---

# Speed Up Tests

Optimize test suite execution time without removing or skipping tests by improving only one single thing

## Constraints

- Do not remove or skip existing tests
- Do not reduce test coverage
- No parallel execution
