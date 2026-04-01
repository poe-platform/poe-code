---
agent: claude-code
metric:
  - name: test_count
    direction: stable
  - name: test_duration
    direction: minimize
baseline:
  test_count: 2725
  test_duration: 73859.97021484375
status:
  state: open
  experiment: 0
  kept: 0
---

# Speed Up Tests

Optimize test suite execution time without removing or skipping tests by improving only one single thing

## Constraints

- Do not remove or skip existing tests
- Do not reduce test coverage
- No parallel execution
