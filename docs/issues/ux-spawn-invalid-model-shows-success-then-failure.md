---
severity: high
impact: usability
reproduced: y
recommendation: fix
evidence: "packages/toolcraft-design/src/acp/components.ts:32 agentPrefix() hardcodes color.green.bold('checkmark') for every agent_message, and :145 renderUsage() hardcodes 'checkmark tokens: ... in -> ... out' unconditionally; packages/agent-spawn/src/acp/renderer.ts:20,34 route agent_message and usage events straight to both, so an API error text and a 0-in/0-out usage line are printed with success glyphs regardless of exit code. No pre-spawn model validation found in packages/agent-spawn/src."
comment: "The clearest instance of the success-glyph problem and worth keeping alongside the umbrella (ux-failure-shown-as-success-markers.md): two check-marks appear - one on the API error itself and one on a '0 in, 0 out' token line - so the output asserts success twice for a run that did nothing and then failed. The token line is the more damning detail: zeroes prove no work happened, yet it is still marked done. Its secondary ask (validate the model before spawn) is the catalog-validation fix from ux-configure-accepts-any-string-as-model-no-catalog-check.md."
---

# UX: spawn invalid model shows success glyphs then failure

## Summary

spawn with --model does-not-exist-xyz prints ✓ agent: API Error: 400 Unsupported model and ✓ tokens then Error: Claude Code spawn failed — success markers on failure.

## Evidence

```bash
$ poe-code spawn claude "hi" --mode read --model does-not-exist-xyz
✓ agent: API Error: 400 Unsupported model: 'does-not-exist-xyz'.
✓ tokens: 0 in → 0 out
■  Error: Claude Code spawn failed with exit code 1
```

## Why it matters

Success glyphs on failure confuse users and break log scanners.

## Suggested direction

No ✓ on failed spawn; validate model before spawn when possible; UserError.

## Severity

**High**

## Area

Spawn / errors
