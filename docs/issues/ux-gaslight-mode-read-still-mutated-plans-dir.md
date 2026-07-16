---
severity: critical
impact: correctness
reproduced: y
recommendation: fix
evidence: "packages/agent-spawn/src/configs/claude-code.ts:23 maps mode read to only ['--permission-mode','plan'] with no write-blocking allowlist (edit mode pins --allowedTools), and packages/agent-gaslight/src/run.ts:181 sends `${config.prompt} ${planPath}` (Implement) regardless of mode, so nothing stops the agent mutating plans/; run.ts:173,250 show gaslight's own archive step does honor --no-archive, so the archive move came from the agent."
comment: "One of the two or three most important files in the audit and correctly Critical: --mode read plus --no-archive both promised safety and the plans directory was still mutated (a plan moved into archive/), caught only because the auditor checked git status. The evidence is strong and specific - including the underlying invocation (claude -p Implement ... --permission-mode plan), which reveals the mechanism: read mode is forwarded to the agent as a permission mode while gaslight itself still issues an Implement prompt and performs its own archiving, so the safety flags never governed gaslight's own filesystem actions. Fix at that level, not by tweaking copy. Ties to ux-gaslight-help-says-plan-to-implement.md and the Implement-default cluster."
---

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
