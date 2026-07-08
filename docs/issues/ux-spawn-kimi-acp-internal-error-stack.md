# UX: spawn kimi fails with ACP Internal error stack

## Summary

spawn kimi --yes: ✗ Internal error AcpError stack from poe-acp-client then Kimi spawn failed exit code 1 + See logs — system chrome and stack dump.

## Evidence

```bash
$ poe-code spawn kimi "say only: ok" --mode read --model novitaai/kimi-k2.5 --yes
✗ Internal error
AcpError: Internal error
    at toResponseError (…/poe-acp-client/…)
■  Kimi spawn failed with exit code 1: Internal error
●  See logs …
```

## Why it matters

Advertised spawn kimi unusable; stacks leak.

## Suggested direction

UserError with configure/login recovery; no stack.

## Severity

**High**

## Area

Spawn / kimi
