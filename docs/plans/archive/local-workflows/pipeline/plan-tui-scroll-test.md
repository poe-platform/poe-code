---
kind: pipeline
version: 1
tasks:
  - id: verbose-task
    title: Verbose echo task to test scrolling
    prompt: |
      Run the following commands in sequence:
      echo "line-1-alpha"
      echo "line-2-bravo"
      echo "line-3-charlie"
      echo "line-4-delta"
      echo "line-5-echo"
      echo "line-6-foxtrot"
      echo "line-7-golf"
      echo "line-8-hotel"
      echo "line-9-india"
      echo "line-10-juliet"
      Do not change any files.
    status: done
---

# tui scroll test

Archived local pipeline plan converted from YAML during docs cleanup.
