---
name: poe-code-ralph-plan
description: 'Generate a Ralph plan (YAML) from a user request. Triggers on: create a plan, write plan for, plan this feature, ralph plan.'
---

## If The Request Is Empty

Ask the user for a one-sentence description of what they want to build.

{{{PROMPT_PARTIAL_PLAN}}}

## Output Path

Write the YAML file to `.agents/poe-code-ralph/plans/plan-<name>.yaml` unless the user specifies a different path.
