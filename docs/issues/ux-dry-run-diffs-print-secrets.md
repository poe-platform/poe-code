---
severity: critical
impact: security
reproduced: y
recommendation: fix
evidence: "src/utils/dry-run.ts:380-388 redactContentForDiff redacts only .json and .toml and returns all other content verbatim; goose keeps CUSTOM_POE_API_KEY in secrets.yaml (src/providers/goose.ts:30-31,305-311) and unconfigure prunes that key (src/providers/goose.ts:327-332), so the .yaml dry-run diff emits the full credential. TOML experimental_bearer_token is already redacted (src/utils/dry-run.ts:18), so redaction is inconsistent rather than absent, as claimed."
comment: "Correctly the #1 issue: dry-run is the flag users reach for precisely to be safe, and it emits full sk-poe- and cfut_ tokens across unconfigure, logout and provider-logout. Its sharpest observation is that redaction is inconsistent rather than absent - utils config show redacts while the mutation diff formatter does not - and ux-configure-api-key-dry-run-redacts-bearer.md confirms redaction already works in the configure path. That reframes the fix from 'build redaction' to 'route every dry-run diff through the existing redactor', far cheaper than Critical usually implies. Ship with the regression tests it asks for."
---

# UX: Dry-run config diffs can print full API keys

## Summary

Dry-run unconfigure/logout/provider-logout mutation previews can emit unified diffs containing full sk-poe- and cfut_ bearer tokens. Dry-run is trusted as safe; it can leak credentials into scrollback/CI logs. Redaction is inconsistent (some paths show <redacted>).

## Evidence

```bash
$ poe-code unconfigure goose --dry-run
+CUSTOM_POE_API_KEY: sk-poe-<FULL_SECRET>
$ poe-code unconfigure codex --dry-run
+experimental_bearer_token = "cfut_…"
+experimental_bearer_token = "sk-poe-…"
$ poe-code logout --dry-run
# same class of secret lines across agents
```
utils config show redacts; dry-run mutation formatter does not uniformly.

## Why it matters

Critical credential leak on the flag users trust as safe. Worse than intentional auth api-key reveal.

## Suggested direction

Redact secret-looking keys/values in all dry-run diffs; never print sk-poe-/Bearer/cfut_; regression tests.

## Severity

**Critical**

## Area

Security / dry-run
