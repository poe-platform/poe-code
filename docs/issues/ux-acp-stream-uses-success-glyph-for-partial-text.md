---
severity: medium
impact: polish
comment: "Sparse filing: no repro or code location beyond 'acp components', so it needs localising before it is actionable. The underlying point is right - a success check-mark used as a bullet for partial streamed text asserts a status the stream has not reached. Neutral bullet is the correct fix. Same glyph-semantics family as ux-success-and-info-share-magenta-glyphs.md; fix them together in the design system, not per call-site."
reproduced: y
recommendation: fix
evidence: "toolcraft-design/src/acp/components.ts:32 agentPrefix returns green bold checkmark; :108 renderReasoning prefixes in-progress thinking text with checkmark while its markdown branch (:95) uses neutral '- *thinking:*'; agent-spawn/src/acp/renderer.ts:70-106 flushes buffered partial chunks so each gets its own checkmark; renderToolComplete (:92) uses the same glyph for real completion"
---

# UX: ACP stream uses ✓ as bullet

## Summary

Checkmark for partial text.

## Evidence

acp components.

## Why it matters

Status glyph misuse.

## Suggested direction

Neutral bullet.

## Severity

Medium

## Area

Visual language
