---
severity: low
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/gaslight.ts:310-324 registers a root action plus subcommands at :373 (ingest) and :428 (install); however src/cli/commands/plan.ts:522-533 uses the identical hybrid shape (root [question] action plus browse/list/view/install subcommands), so the doc's premise that no other command mixes both shapes is false - this is an established convention, not a defect."
comment: "Thoughtful structural observation, correctly Low: gaslight is both an action and a group, which no other command in the CLI does, making it hard to document and hard to tab-complete. Not urgent, but this kind of shape gets more expensive to change later, and it interacts with ux-completion-command-missing.md, which needs a consistent command shape to generate from. Note this file is absent from MASTER.md - untracked by the master list."
---

# UX: gaslight is a hybrid command — both runs directly and has subcommands

## Summary

`poe-code gaslight [plan-path]` runs a gaslight loop directly when invoked with a plan path. At the same time, it has two subcommands (`ingest`, `install`) visible in its `Commands:` section.

This hybrid pattern — "I'm both an action and a group" — is unusual and does not follow the pattern of any other command in poe-code. Every other command is either:
- A direct action with no subcommands (e.g. `spawn`, `configure`, `models`)
- A group command with only subcommands and no direct action (e.g. `memory`, `runtime`, `provider`)

`gaslight` is neither — it mixes both shapes.

## Evidence

```
Usage: poe-code gaslight [options] [plan-path]

Run a plan through a resumable sequence of agent follow-ups.

...

Commands:
  ingest [options]   Generate a gaslight config from local Claude and Codex traces.
  install [options]  Install a default gaslight.yaml configuration.
```

## Why it matters

Users scanning the top-level help see `gaslight` in the commands list with no indication that it has subcommands. Users who find `gaslight ingest` may not realize it's under gaslight. Tab completion shows both the direct invocation pattern and subcommands simultaneously.

## Suggested direction

Either promote `ingest` and `install` to `gaslight run`, or make gaslight a group (`gaslight run [plan-path]`) and keep `ingest`/`install` as siblings. The current shape is hard to document and hard to tab-complete.

## Severity

Low

## Area

Gaslight / command structure / help / discoverability
