---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/auth.ts:25-29 description 'Display stored API key.' with no options; executeApiKey writes raw key (auth.ts:113); 'npm run dev -- auth api-key --help' prints Options: -h, --help only"
comment: "One of four filings that auth api-key help carries no secret warning. Consolidate to one. Important sequencing note for the whole sub-cluster: it is dependent on ux-auth-api-key-prints-secret.md - if masking plus --reveal lands, 'help does not warn that it prints a secret' largely evaporates. Schedule after that fix and keep only the residue: mark the command sensitive and document --reveal."
---

# UX: auth api-key --help has no danger note or mask flag

## Summary

auth api-key help: Display stored API key; Options only -h — no --mask, no danger that it prints full secret (Critical #3).

## Evidence

```text
Display stored API key.
Options: -h only
```

## Why it matters

Help must warn before users run secret reveal.

## Suggested direction

Danger: prints full secret. Prefer --mask default; --reveal opt-in.

## Severity

**High**

## Area

Auth / security
