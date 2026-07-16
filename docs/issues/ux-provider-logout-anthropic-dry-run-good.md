---
severity: low
impact: none
reproduced: n
recommendation: no-fix
evidence: "npm run dev -- provider logout anthropic --dry-run floods ~/.claude/settings.json diffs when an agent maps to anthropic; src/cli/commands/provider.ts:390 unconfigureServicesForProvider runs in dry-run, filtered only by metadata.provider at provider.ts:566, so cleanliness depends on local config, not the provider"
comment: "Valuable positive and the direct refutation of part of ux-provider-logout-no-confirmation.md, which asserts provider logout has no --dry-run: this shows --dry-run works and prints exactly the right thing - the credential file it would remove, nothing more. Keep and link. Its contrast with the poe logout flood again shows the blast radius is provider-specific."
---

# UX: provider logout anthropic --dry-run is clean (positive)

## Summary

provider logout anthropic --dry-run only shows would log out + rm credentials.anthropic.enc — good contrast to provider logout poe multi-agent flood.

## Evidence

```bash
$ poe-code provider logout anthropic --dry-run
●  Dry run: would log out from anthropic.
●  rm …/credentials.anthropic.enc # delete
```

## Why it matters

Positive credential-only logout dry-run.

## Suggested direction

Make poe logout dry-run match this calm style.

## Severity

Low

## Area

Providers / positive pattern
