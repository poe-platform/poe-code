---
severity: medium
impact: usability
reproduced: y
recommendation: fix
evidence: "src/cli/commands/agent.ts:47 passes --model straight to createAgentSession; packages/poe-agent/src/agent-session.ts:96-98 only rejects empty; poe-agent-plugin-openai-chat-completions.ts:108 'supports: () => true' so unknown ids hit api.poe.com and the OpenAI SDK 404 surfaces via src/cli/bootstrap.ts:73-78 as 'Error: ...' plus 'See logs at .../errors.log'"
comment: "Contentless filing (Summary '404 + logs.', Evidence 'agent --model not-real.') - needs a pasted repro before anyone works it. The point stands: an unknown model id is a user error, so a raw 404 plus log tease is the wrong presentation; it should name the bad id and point at 'models'. The durable fix is validating model ids against the catalog before the API call, shared with ux-configure-accepts-any-string-as-model-no-catalog-check.md."
---

# UX: agent invalid model 404 system

## Summary

404 + logs.

## Evidence

agent --model not-real.

## Why it matters

Featured command.

## Suggested direction

ValidationError.

## Severity

Medium

## Area

Agent
