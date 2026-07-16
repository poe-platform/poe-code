---
severity: low
impact: none
reproduced: y
recommendation: no-fix
evidence: "src/cli/commands/shared.ts:203-207 throws 'Unknown API shape \"...\" for provider ...  Exposed shapes: ' via formatApiShapeList (shared.ts:191,218); test src/cli/commands/configure.test.ts:1328 asserts it"
comment: "Most valuable positive in the configure set: in-product proof that this codebase already does the right thing on invalid input - reject, name the bad value, list the valid ones. Cite it as the reference from every 'no recovery list' filing (ux-configure-unknown-provider-see-logs-missing.md, ux-configure-provider-requires-model-without-listing-models.md, ux-approvals-invalid-state-silent-empty-reconfirmed.md). No change needed."
---

# UX: configure unknown API shape lists exposed shapes (positive)

## Summary

configure --shape-base-url messages=… → Unknown API shape "messages" for provider poe. Exposed shapes: openai-chat-completions, openai-responses, anthropic-messages.

## Evidence

Unknown API shape "messages" … Exposed shapes: …

## Why it matters

Positive shape validation with allow-list.

## Suggested direction

Keep; use anthropic-messages in examples.

## Severity

Low

## Area

Configure / positive pattern
