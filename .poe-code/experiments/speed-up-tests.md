---
agent: claude-code
install: npm install
metric:
  - name: test_count
    direction: stable
  - name: test_duration
    direction: minimize
baseline: null
model: claude-sonnet-4-20250514
status:
  state: open
  experiment: 0
  kept: 0
---

# Speed Up Tests

Optimize test suite execution time without removing or skipping tests.

## Prompt

Run single experiment to speed up test.

## Constraints

- Do not remove or skip existing tests
- Do not reduce test coverage
- Focus on: reducing unnecessary setup, parallelization, faster mocks, avoiding redundant work
