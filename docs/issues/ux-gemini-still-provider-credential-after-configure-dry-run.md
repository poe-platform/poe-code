---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/isolated-env.ts:131 throws plain Error 'Cannot resolve \"providerCredential\": no active provider on context.'; src/cli/commands/configure.ts:279 dry message 'Dry run: would configure ${adapter.label}.' writes nothing, so unreadiness after dry-run is by design. Duplicate of canonical ux-spawn-gemini-provider-credential-opaque-error.md."
comment: "Two things tangled. The valid part is the opaque error: 'Cannot resolve providerCredential: no active provider on context' leaks internal resolution vocabulary with no recovery steps - same class as ux-spawn-gemini-provider-credential-opaque-error.md, so consolidate. The invalid part is the framing: --dry-run is not supposed to establish readiness, so 'dry-run does not help readiness' is expected rather than a defect. Keep the error-copy ask, drop the dry-run complaint."
---

# UX: spawn gemini still fails providerCredential after configure dry-run only

## Summary

configure gemini --dry-run plans quiet success; spawn gemini still Cannot resolve providerCredential — reconfirm gemini needs real configure + provider login; dry-run does not help readiness.

## Evidence

```bash
$ poe-code configure gemini --yes --dry-run
●  Dry run: would configure Gemini CLI.
$ poe-code spawn gemini "ok" --mode read
■  Error: Cannot resolve "providerCredential": no active provider on context.
```

## Why it matters

Reconfirm opaque gemini credential error; dry-run does not validate readiness.

## Suggested direction

UserError with configure gemini + provider login cloudflare/poe steps.

## Severity

**High**

## Area

Spawn / gemini
