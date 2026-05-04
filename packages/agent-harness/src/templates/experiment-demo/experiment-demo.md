---
$schema: https://poe-platform.github.io/poe-code/schemas/harnesses/experiment-demo.schema.json
kind: experiment-demo
version: 1
agents:
  experimenter:
    agent: claude-code
    mode: edit
    prompt: |
      Make one focused attempt to improve the target metric.
metric:
  name: tests
  direction: maximize
attempts:
  - id: baseline
    prompt: Make a conservative improvement attempt.
  - id: follow-up
    prompt: Try one follow-up based on the previous attempt shape.
---

# Experiment Demo

Try a small improvement, keep it when it moves the target metric in the right
direction, then carry the useful context into the next attempt.
