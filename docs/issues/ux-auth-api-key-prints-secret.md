---
severity: critical
impact: security
comment: "Keep as canonical for the base defect: auth api-key prints the full key unmasked with no opt-in. Correctly Critical, and it is the decision point the rest of the auth cluster hangs off - the four dry-run files and the four help-warning files all resolve once masking plus explicit --reveal exists. Absorbs ux-auth-api-key-displays-secret-to-stdout.md, whose command-substitution use case the fix must preserve via --reveal."
reproduced: y
recommendation: fix
evidence: "src/cli/commands/auth.ts:116 executeApiKey does process.stdout.write(apiKey) unmasked; rg for 'reveal' across src/cli and packages/providers returns no matches, so no opt-in flag exists"
---

# UX: auth api-key prints the full secret to the terminal

## Summary

poe-code auth api-key writes the complete Poe API key to stdout with no masking, confirmation, or design-system framing.

## Evidence

```bash
$ poe-code auth api-key
sk-poe-<full-secret>
```

## Why it matters

API keys are credentials; scrollback/screenshots/CI capture stdout.

## Suggested direction

Default masked output; require explicit --reveal for full key.

## Severity

**Critical**

## Area

Auth / security
