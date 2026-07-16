---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/runtime/build.ts:67-73 throws ValidationError with recovery hint; message now says 'Pass --runtime docker' only, no e2b"
comment: "Genuinely good positive and a strong recovery template: it names the constraint, both flag alternatives and the config key that would set it permanently - three routes forward in one line. Cite it from ux-braintrust-status-disabled-no-next-step.md and ux-configure-provider-requires-model-without-listing-models.md, which fail in exactly this shape. Notably it is also the counterexample to the runtime cluster's silent no-ops: here an unsatisfiable request errors clearly instead of proceeding."
---

# UX: runtime build host no-template message is good (positive)

## Summary

Host runtime has no template to build with pass --runtime e2b/docker or config hint — clear recovery.

## Evidence

```bash
$ poe-code runtime build
■  Host runtime has no template to build. Pass --runtime e2b or --runtime docker, or set "runtime": { "type": "..." } in .poe-code/config.json.
```

## Why it matters

Positive recovery pattern.

## Suggested direction

Keep.

## Severity

Low

## Area

Runtime / positive pattern
