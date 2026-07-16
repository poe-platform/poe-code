---
severity: high
impact: usability
comment: "Real and confusing: the message claims Claude Code 'is not configured via poe' when the user supplied both model and mode explicitly, so it reports a configuration problem for a request that needed no configuration. The likely truth is that the hooks bridge wants confirmation, which is what its suggested rewording says. Same misdiagnosis family as the gemini credential error and ux-code-review-run-invalid-url-wrong-error.md - the message names the wrong cause."
reproduced: n
recommendation: no-fix
evidence: "Already fixed: commit 946f67ea7 'fix(spawn): remove implicit Poe requirements' deleted confirmUnconfiguredService from src/cli/commands/spawn.ts; grep for 'not configured via poe' / 'proceed without prompting' finds no hits in src/ or packages/"
---

# UX: spawn --hooks-from with auto demands --yes with not configured via poe message

## Summary

spawn claude with model + --hooks-from claude-code --hooks-strategy auto non-TTY: Claude Code is not configured via poe. Pass --yes to proceed without prompting — even with explicit model; confuses hooks path with configure status.

## Evidence

```bash
$ poe-code spawn claude "say only: ok" --mode read --model anthropic/claude-haiku-4.5 --hooks-from claude-code --hooks-strategy auto
■  Claude Code is not configured via poe. Pass --yes to proceed without prompting.
```

## Why it matters

Hooks/spawn path should not require --yes when model/mode provided; message implies misconfiguration.

## Suggested direction

Honor flags without --yes; or clearer: Hooks bridge requires confirmation. Pass --yes.

## Severity

**High**

## Area

Spawn / hooks
