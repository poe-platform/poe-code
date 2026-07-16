---
severity: high
impact: usability
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/provider.ts:353 executeProviderLogout calls unconfigureServicesForProvider, which invokes each matching agent's unconfigure with the dry-run fs (src/cli/commands/provider.ts:465-524); src/utils/dry-run.ts:85-107 records writeFile/rm ops that are printed as diffs. Local probe showed only credential rm because no agent is configured with provider poe on this machine. Duplicate of ux-provider-logout-dry-run-unconfigures-agents.md."
comment: "One of three filings of the poe provider-logout scope problem; consolidate into ux-provider-logout-dry-run-unconfigures-agents.md. Its distinct detail is the most damning: the agent diffs include effortLevel and backup deletes, so a credential logout plans to mutate agent settings and remove backups - which is also where the secret leak originates (ux-logout-dry-run-still-prints-secrets-reconfirmed.md). Fix the scope and the leak surface shrinks."
---

# UX: provider logout poe --dry-run still plans agent config mutations

## Summary

provider logout poe --dry-run still emits large agent settings diffs (claude plugins, effortLevel, etc.) and backup deletes — logout of provider looks like unconfigure all agents (reaffirm provider-logout-dry-run-unconfigures-agents).

## Evidence

```bash
$ poe-code provider logout poe --dry-run
# large + blocks of claude settings
●  Dry run: would log out from poe.
```

## Why it matters

Provider logout scope unclear; dry-run floods and may leak secrets.

## Suggested direction

Summarize agents that would unconfigure; redact secrets; confirm blast radius.

## Severity

**High**

## Area

Providers / dry-run
