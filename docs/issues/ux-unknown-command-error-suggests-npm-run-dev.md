---
severity: critical
impact: discoverability
comment: "The best-argued file in the identity cluster and its reasoning earns the Critical rating better than any sibling: every typo routes users to a recovery command that cannot work for an installed user, so the error's only actionable line is a dead end. Retire into ux-development-mode-usage-intentional-but-leaks.md, which names the mechanism, but carry this argument - it is the clearest statement of user impact in the cluster. Same caveat as the rest: verify against an installed binary, since the leak may be a tsx-only artefact."
---

# UX: unknown command error tells users to run "npm run dev -- --help"

## Summary

When any unrecognised command is passed to `poe-code`, the error panel's recovery line reads:

```
Run npm run dev -- --help for available commands.
```

This exposes the internal developer script invocation to all end users. Installed users who mistype a command are told to run a command that will fail for them (`npm run dev` requires a clone of the source repo and a working Node.js dev environment).

## Evidence

Confirmed across multiple unknown command errors:
```
% poe-code status --help
[
  Poe - command not found

■  Unknown command: status

   Run npm run dev -- --help for available commands.
[
```

Same text appears for: `poe-code wrap`, `poe-code mcp`, `poe-code eval --help` (quoted), and any other unrecognised string.

## Why it matters

Critical: every typo a production user makes sends them to a broken recovery path. They run `npm run dev -- --help`, get a "missing script" error, and are stuck with no valid next step.

## Suggested direction

Replace with `poe-code --help` (the installed binary name, derived from $0):

```
Run poe-code --help for available commands.
```

## Severity

Critical

## Area

CLI / error-handling / recovery message
