---
severity: low
impact: none
comment: "Positive pattern and a good model for recovery copy: it names the env var and the config path, so the user can act without searching. Cite it from ux-configure-provider-requires-model-without-listing-models.md and ux-braintrust-status-disabled-no-next-step.md, which fail exactly where this succeeds. Its 'See logs' residue is the systemic UserError issue, not an E2B problem."
reproduced: n
recommendation: no-fix
evidence: "Positive note; E2B runtime removed in commit d6ed24391 'refactor: remove e2b runtime', and packages/agent-spawn/src/acp/spawn-acp.ts now types runtime as host|docker, so the cited message no longer exists."
---

# UX: E2B missing API key error is good (positive)

## Summary

No E2B API key message points to E2B_API_KEY and config.json paths — good recovery (still See logs).

## Evidence

```bash
$ poe-code spawn … --runtime e2b
■  Error: No E2B API key. Set E2B_API_KEY or e2b.api_key in …config.json
```

## Why it matters

Positive recovery pattern.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Spawn / positive pattern
