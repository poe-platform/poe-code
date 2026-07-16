---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/shared.ts:491 resolveServiceAdapter throws 'Unknown agent' for registry misses; pi has spawn config (packages/agent-spawn/src/configs/pi.ts:9) and agent def (packages/agent-defs/src/agents/pi.ts:3) but no provider, and configure.test.ts:224-234 asserts configure/unconfigure pi reject with 'Unknown agent \"pi\".'"
comment: "Root-cause filing worth keeping. The error is actively wrong, not just unhelpful: pi IS known, it is spawn-only, so 'Unknown agent' misdiagnoses the situation and sends users looking for a typo. Two fixes: (1) per-agent capability metadata as the single source so spawn/configure/install lists derive from it and cannot drift; (2) spawn-only agents answer 'pi is spawn-only, not configurable'. Same root cause as ux-test-and-install-reject-spawn-only-agents-as-unknown.md, ux-unconfigure-pi-unknown-not-spawn-only.md and ux-unknown-agent-no-allow-list-or-suggestions.md - fix once, close all four."
---

# UX: spawn/configure/install agent lists disagree (capability matrix)

## Summary

spawn accepts pi, pi-agent, poe-agent; configure/install omit pi/poe-agent; configure pi → Unknown agent. No matrix of spawnable vs configurable vs installable.

## Evidence

```text
spawn agents: … | pi | pi-agent | poe-agent
configure agents: … | opencode  (no pi, no poe-agent)
install agents: same as configure
$ poe-code configure pi
■  Unknown agent "pi".
```
spawn goose/test goose work with haiku.

## Why it matters

Users hit Unknown agent when configuring spawnable agents; platform fix: capability matrix.

## Suggested direction

Publish matrix in help: spawnable / configurable / installable columns; message: pi is spawn-only.

## Severity

**High**

## Area

Help / capability matrix
