---
severity: low-medium
impact: usability
comment: "Keep of this pair (it has the actionable ask). The message is accurate but dead-ends, and its 'list search paths' suggestion matters more than it appears: because ux-harness-list-only-cwd-not-created-dir.md shows discovery ignores --dir, 'no pairs found' can be false rather than merely unhelpful. Naming the searched paths would expose that."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/harness.ts:700 resolveDiscoveredHarness throws ValidationError('No harness pairs found.') with no 'harness new' next step and no listing of the searched roots, which discoverProjectThenUserHarnesses hardcodes to cwd/.poe-code/harnesses and homeDir/.poe-code/harnesses (harness.ts:737-742); the pick prompt at harness.ts:717 only runs when pairs exist, so the zero-pair path dead-ends."
---

# UX: harness run without path says No harness pairs found

## Summary

harness run --yes without md-path: No harness pairs found — OK if empty, but does not prompt to pick or suggest harness new.

## Evidence

```bash
$ poe-code harness run --yes
■  No harness pairs found.
```

## Why it matters

Missing next-step to create harness.

## Suggested direction

Suggest harness new <kind> <name>; list search paths.

## Severity

Low–Medium

## Area

Harness
