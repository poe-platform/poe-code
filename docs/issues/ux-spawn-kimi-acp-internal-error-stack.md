---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "kimi routes to ACP (packages/agent-spawn/src/configs/kimi.ts:34-39 kimiAcpSpawnConfig, chosen at src/sdk/spawn.ts:233); poe-acp-client rejects with bare AcpError('Internal error') (packages/poe-acp-client/src/jsonrpc-message-layer.ts:158,175,535); spawn-acp.ts error handler attaches error.stack to the error event and renderer.ts:49-53 prints message + full stack; src/cli/commands/spawn.ts:428 then throws 'spawn failed with exit code 1: Internal error' and src/cli/bootstrap.ts:71-79 appends 'Error:' + 'See logs' chrome"
comment: "Real and worth High: an advertised agent fails with a bare 'Internal error' plus an AcpError stack from poe-acp-client, so the user gets a stack trace and no cause. Unlike most of the spawn cluster this is not the dead-default model - the invocation uses an explicit kimi model - so it needs its own investigation. Note the tension with ux-spawn-kimi-not-configured-yes-message.md, which shows an unconfigured kimi producing a clean message: here --yes was passed, so the internal error appears on the path that bypasses that guard. Worth checking whether --yes skips configuration kimi actually needs."
---

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
