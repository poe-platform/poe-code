---
severity: high
impact: discoverability
comment: "One of several 'pi is spawn-only but reported unknown' filings; retire into ux-install-test-pi-unknown-not-spawn-only.md (which covers install and test) or the capability-matrix canonical. Its own question is worth keeping: whether pi should be installable at all given the binary is external - a product decision the matrix work must answer rather than assume."
---

# UX: install pi fails as unknown (pi spawnable but not installable)

## Summary

install pi → Unknown agent; pi is spawnable but not in install agent list — capability matrix gap (related pi-spawnable-but-not-configurable).

## Evidence

install pi → Unknown agent "pi".

## Why it matters

Users cannot install pi via poe-code install even if binary is external.

## Suggested direction

Agent capability matrix: spawnable vs installable; clearer message.

## Severity

**High**

## Area

Install / capability matrix
