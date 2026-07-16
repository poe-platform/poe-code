---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/provider.ts:172 login calls refreshConfiguredServicesForProvider, which re-runs each configured agent's configure (line 496-540); reasoningEffort comes from stored metadata (line 519), so xhigh is echoed from config, not injected - no 'xhigh' literal exists in src/ or packages/"
comment: "Strong and distinct filing: provider login poe --dry-run plans a full ~/.claude/settings.json rewrite including effortLevel xhigh, so a credential operation reaches into agent configuration. That is a scope problem rather than a presentation one - login should not reconfigure agents - and the contrast with ux-provider-login-anthropic-dry-run-clean.md (same command, credential-only for anthropic) proves the coupling is poe-specific and probably unintentional. It also independently corroborates the xhigh effort cluster and the ux-live-claude-settings-had-sonnet-alias-and-xhigh-restored.md incident: here is a plausible writer of xhigh into live settings. Worth investigating for that reason alone."
---

# UX: provider login poe --dry-run also plans Claude settings rewrite with effortLevel xhigh

## Summary

provider login poe --api-key sk-fake --dry-run not only would save credential but also plans full ~/.claude/settings.json rewrite including effortLevel xhigh — dry-run flood + dead effort coupling; login should not reconfigure agents.

## Evidence

```bash
$ poe-code provider login poe --api-key sk-fake --dry-run
# includes cat > ~/.claude/settings.json with effortLevel: xhigh
●  Dry run: would save credential for poe.
```

## Why it matters

Provider login dry-run overclaims scope into agent configs; xhigh effort cluster.

## Suggested direction

Credential-only dry-run; intentional-only diffs; no agent rewrite on login.

## Severity

**High**

## Area

Providers / dry-run
