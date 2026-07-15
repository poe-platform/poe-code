---
severity: low
impact: none
comment: "Positive pattern and a good recovery message: it names the missing input, the flag and the env var alternative. Cite it from ux-configure-gemini-requires-cloudflare-base-url-when-provider-set.md, where the same requirement surfaces confusingly because the user never chose cloudflare - the message is fine, the provider selection is the problem there. Its 'See logs' residue is the systemic UserError issue."
---

# UX: provider login cloudflare missing base URL is clear (positive)

## Summary

Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL — clear recovery (still See logs on one path).

## Evidence

```bash
$ poe-code provider login cloudflare --yes
■  Error: Provider "cloudflare" requires a base URL. Pass --base-url or set CF_AIG_BASE_URL.
```

## Why it matters

Positive required-field recovery.

## Suggested direction

Keep; drop See logs.

## Severity

Low

## Area

Providers / positive pattern
