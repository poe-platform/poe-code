---
severity: medium
impact: security
comment: "Member of the four-surface --api-key argv class; retire into the umbrella ux-auth-login-api-key-shell-history-risk.md. Its fallback suggestion is the pragmatic one and worth carrying: if the flag must stay, warn at runtime that the key will land in shell history - a one-line mitigation that does not require removing the flag."
---

# UX: provider login --api-key flag encourages shell history leak

## Summary

`provider login --help` lists `--api-key <key>` as a first-class option. Passing secrets via CLI args leaks them into shell history and process listings — same class as agent --help and auth api-key (issues #239, #245).

## Evidence

```
Options:
  --api-key <key>    API key for the provider
```

## Why it matters

Users prompted to pass `--api-key` inline expose secrets to `history`, `/proc`, and any terminal log. Env var or interactive prompt is safer.

## Suggested direction

Recommend `POE_API_KEY` / provider-specific env var instead; if flag is retained, warn that key will appear in shell history.

## Severity

Medium

## Area

Provider auth / security
