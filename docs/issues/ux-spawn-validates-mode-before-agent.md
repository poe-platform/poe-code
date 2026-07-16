---
severity: medium
impact: usability
comment: "Contentless duplicate within the validation-order trio; retire into ux-spawn-validates-mode-before-agent-reconfirmed.md. Its four-word framing is accurate ('Wrong recovery path') and captures why order matters: the error decides where the user looks next."
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/spawn.ts:223 resolveSpawnMode runs before resolveSpawnTarget:239; `npm run dev -- spawn notreal hi --dry-run` printed 'spawn requires --mode when running without an interactive TTY' instead of an unknown-agent error; duplicate of ux-spawn-validates-mode-before-agent-reconfirmed.md"
---

# UX: spawn validates mode before agent

## Summary

Invalid agent fails missing --mode first.

## Evidence

spawn notreal.

## Why it matters

Wrong recovery path.

## Suggested direction

Validate agent first.

## Severity

Medium

## Area

Spawn / errors
