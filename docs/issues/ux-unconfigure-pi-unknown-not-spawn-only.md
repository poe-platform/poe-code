---
severity: high
impact: discoverability
comment: "Duplicate within the spawn-only messaging family; retire into ux-install-test-pi-unknown-not-spawn-only.md or the capability-matrix canonical. Coverage only - it adds unconfigure as the fourth command giving the same wrong answer."
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
