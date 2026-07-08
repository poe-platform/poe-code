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
