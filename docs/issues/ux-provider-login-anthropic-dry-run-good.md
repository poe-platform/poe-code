---
severity: low
impact: none
comment: "Keep of this pair (its 'mirror for logout and configure' direction is the actionable half). It establishes the calm credential-only dry-run that the poe login path and the logout flood should match - the good pattern exists in the same command and diverges only by provider, a strong argument that the flood is incidental rather than necessary."
reproduced: n
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:192 emits 'Dry run: would save credential for ${id}.'; probe 'npm run dev -- provider login anthropic --api-key test-key --yes --dry-run' printed exactly that, no secret - positive note, no defect"
---

# UX: provider login anthropic --dry-run is quiet and clear (positive)

## Summary

provider login anthropic --api-key test --yes --dry-run says would save credential without dumping secrets — good dry-run (contrast provider logout).

## Evidence

```bash
$ poe-code provider login anthropic --api-key test-key --yes --dry-run
●  Dry run: would save credential for anthropic.
```

## Why it matters

Positive dry-run pattern for credentials.

## Suggested direction

Mirror for logout and configure.

## Severity

Low

## Area

Providers / positive pattern
