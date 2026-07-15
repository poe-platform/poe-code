---
severity: high
impact: security
comment: "Keep as canonical for the dry-run flood: strongest evidence and the only filing that names the privacy dimension - the diff reprints unrelated project paths, plugins and marketplaces from the user's machine, so the output is not merely noisy, it discloses filesystem layout, and it carries secrets too. Absorbs the three codex flood files and ux-configure-dry-run-floods-diff.md. Its 'N project entries preserved' suggestion is the right shape for the fix."
---

# UX: configure/unconfigure dry-run dumps entire existing agent config including unrelated projects

## Summary

configure codex --dry-run emits a full rewrite-style diff of the agent config that includes dozens of unrelated [projects."/Users/…"] paths and plugin marketplaces from the existing file, not just the intended Poe-related changes. Combined with secret leakage, this is a privacy and noise disaster.

## Evidence

```bash
$ poe-code configure codex --provider openai --yes --dry-run
# huge + blocks for many project paths under other repos, plugins, marketplaces
+experimental_bearer_token = "cfut_…" / "sk-poe-…"
```

## Why it matters

Users cannot see what actually changes; dry-run exposes private filesystem paths and secrets; unusable as a review tool.

## Suggested direction

Diff only intentional poe-code mutations; redact secrets; summarize "N project entries preserved" instead of reprinting them.

## Severity

**High**

## Area

Dry-run / privacy
