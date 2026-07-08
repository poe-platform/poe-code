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
