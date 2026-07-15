---
severity: low
impact: polish
comment: "Valid, tiny, correctly Low: '/experiment' in the description is an internal skill-path reference that reads like a stray CLI fragment, and the --agent description ends mid-sentence. Both are one-line copy fixes. Note this file is absent from MASTER.md, so it is untracked by the master list - add it, or accept that the master count understates the backlog."
---

# UX: experiment install description embeds internal path "/experiment"

## Summary

`poe-code experiment install --help` shows:

```
Install the Experiment /experiment skill and scaffold experiment files.
```

The `/experiment` in the description is an internal skill path reference, not a path the user would use or recognize. It leaks the implementation detail of how the skill is stored.

Additionally, `--agent <name>` description reads "Agent to install the Experiment skill for" — the sentence ends with the preposition "for", which is grammatically incomplete.

## Why it matters

Users reading "Install the Experiment /experiment skill" have no context for what `/experiment` means. It looks like a CLI path or option fragment embedded in the description.

## Suggested direction

- Remove the internal path: "Install the Experiment skill and scaffold experiment files"
- Fix the agent description: "Agent to install the skill for" → "Target agent"

## Severity

Low

## Area

Experiment / install / help / description quality
