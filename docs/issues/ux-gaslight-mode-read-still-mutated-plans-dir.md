# UX: gaslight --mode read --no-archive still mutated plans/ (agent archive)

## Summary

gaslight docs/plans/README.md --mode read --yes --model haiku --no-archive still ran Implement prompt and left plans/tiny-http-mcp-server-production-hardening.md moved into archive/ (restored after probe). --mode read / --no-archive did not prevent plan-dir mutation.

## Evidence

```bash
$ poe-code gaslight docs/plans/README.md --mode read --yes --model anthropic/claude-haiku-4.5 --no-archive
◇  Prompt → Implement docs/plans/README.md
# agent ran; git status showed D docs/plans/tiny-http… and ?? archive/tiny-http…
```
Process was: claude -p Implement … --permission-mode plan

## Why it matters

Read mode + --no-archive promised safety; plans directory still changed. Destructive surprise during audit.

## Suggested direction

Default prompt must not Implement; honor --no-archive for gaslight itself; mode read should deny filesystem writes to plans/; restore/guard plan tree.

## Severity

**Critical**

## Area

Gaslight / destructive
