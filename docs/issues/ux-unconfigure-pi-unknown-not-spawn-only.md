---
severity: high
impact: usability
comment: "Duplicate within the spawn-only messaging family; retire into ux-install-test-pi-unknown-not-spawn-only.md or the capability-matrix canonical. Coverage only - it adds unconfigure as the fourth command giving the same wrong answer."
reproduced: y
recommendation: no-fix
evidence: "npm run dev -- unconfigure pi --dry-run prints 'Error: Unknown agent \"pi\".'; pi exists only as spawnable agent (packages/agent-defs/src/agents/pi.ts), no provider, so src/cli/commands/shared.ts:491 throws before unconfigure.ts:43 spawn-only branch; duplicate of ux-install-test-pi-unknown-not-spawn-only.md"
---

# UX: unconfigure pi says Unknown agent not spawn-only

## Summary

unconfigure pi --dry-run: Unknown agent "pi" — same capability matrix gap as install/test.

## Evidence

Unknown agent "pi".

## Why it matters

Reconfirm capability matrix for unconfigure.

## Suggested direction

pi is spawn-only (not unconfigurable).

## Severity

**High**

## Area

Unconfigure / capability
