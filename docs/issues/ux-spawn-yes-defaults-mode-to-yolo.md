---
severity: critical
impact: security
reproduced: y
recommendation: fix
evidence: "src/cli/commands/spawn.ts:485-487 resolveSpawnMode returns 'yolo' when flags.assumeYes, while the interactive select initialValue is 'edit' (line 507); help text at line 99 states '--yes uses yolo'."
comment: "Keep as canonical of this pair and correctly Critical: --yes conventionally means 'accept safe defaults' and here it means 'grant full permissions', so every CI script that habitually passes --yes runs in yolo. The blast radius is unbounded because yolo is defined as full permissions. It is also the worst instance of the silent-defaults family - and ux-spawn-yes-not-in-options.md shows the flag is not even listed in Options, so the only mention of this behavior is a parenthetical inside another flag's description. Its fix is right: --yes should default to auto or read and yolo must be explicit."
---

# UX: spawn --yes defaults --mode to yolo

## Summary

spawn --help: --mode prompted; --yes uses yolo — CI --yes becomes full yolo permissions without explicit opt-in.

## Evidence

--mode <mode> Permission mode: yolo | auto | edit | read (prompted; --yes uses yolo)

## Why it matters

--yes should accept defaults safely; yolo as --yes default is high blast radius.

## Suggested direction

--yes default mode auto or read; require explicit --mode yolo for yolo.

## Severity

**Critical**

## Area

Spawn / safety
