---
severity: medium
impact: usability
comment: "Keep as canonical for raw-Commander missing-argument errors: it covers both agent and spawn and absorbs ux-agent-missing-prompt-raw-commander.md and ux-spawn-missing-agent-raw-commander.md. The fix belongs at the Commander integration layer (exitOverride / showHelpAfterError mapped into a design-system ValidationError with an example), not per command, because ux-raw-commander-missing-args.md reports the identical skin break elsewhere."
---

# UX: agent/spawn missing required args still raw Commander

## Summary

agent without prompt and spawn without agent print error: missing required argument without design-system framing (unlike many other errors).

## Evidence

```bash
$ poe-code agent
error: missing required argument 'prompt'
$ poe-code spawn
error: missing required argument 'agent'
```

## Why it matters

Inconsistent error skin for first-touch mistakes.

## Suggested direction

Design-system ValidationError with usage examples.

## Severity

Medium

## Area

Errors
