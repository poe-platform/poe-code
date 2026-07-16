---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "No completion command registered in src/cli/program.ts (registrations lines 20-50); `npm run dev -- completion bash` prints 'Unknown command: completion' via src/cli/command-not-found.ts"
comment: "Genuine capability gap, well evidenced (completion, completion bash and --completion all rejected), and distinct from the discoverability cluster because nothing exists to discover. Note the dependency: completion output is only maintainable if the command registry is the single source of truth, which is the same underlying problem behind root help hiding commands - sequence it after that."
---

# UX: shell completion command missing

## Summary

completion / completion bash / --completion all unknown. No bash/zsh/fish completion install path.

## Evidence

Unknown command: completion; unknown option --completion

## Why it matters

CLI UX for power users incomplete; related doctor/completion gaps.

## Suggested direction

poe-code completion bash|zsh|fish.

## Severity

Medium

## Area

Help / install
