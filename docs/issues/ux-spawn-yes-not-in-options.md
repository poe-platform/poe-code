---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "npm run dev -- spawn --help lists no --yes entry; --yes is a root-only option at src/cli/program.ts:852 and showGlobalOptions is never enabled (src/cli/program.ts:320), so it surfaces only inside the --mode text at src/cli/commands/spawn.ts:99"
comment: "Better than a help nit because of what is hidden: --yes is absent from Options and its only mention is a parenthetical in the --mode description - and the thing that parenthetical discloses is that --yes grants yolo (ux-spawn-yes-defaults-mode-to-yolo.md). So the CLI's most dangerous default is documented in the least discoverable place. Its suggested entry is right and should state the permission consequence. Part of the global-flags family but worth keeping for the safety angle."
---

# UX: spawn --yes flag not listed in Options section

## Summary

`spawn --help` does not list `--yes` as its own option. The flag is mentioned only inside the `--mode` description as a parenthetical ("prompted; --yes uses yolo") — users cannot discover it from the Options list.

## Evidence

```
Options:
  --agent <name>         Agent to use for spawning
  --model <model>        Model override passed to the agent
  --mode <mode>          Spawn mode: yolo, normal (prompted; --yes uses yolo)
  --task <text>          Task to execute
  --worktree             Run in a managed git worktree
  -h, --help             Display help for command
```

`--yes` is absent from Options; its existence is only inferred from the `--mode` description text.

## Why it matters

Users running `spawn` in CI or scripted contexts cannot find `--yes` by scanning the Options list. Discovery requires reading every description line carefully.

## Suggested direction

Add `--yes` as an explicit entry in the Options section with its own description (e.g. "Accept defaults and skip prompts (uses yolo mode)").

## Severity

Medium

## Area

Spawn / help / discoverability
