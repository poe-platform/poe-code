---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# Agent OTel capture alongside ACP

Capture OpenTelemetry traces emitted by spawned agents and merge their per-LLM-call detail into the ACP `_meta` channel so it flows through to the Braintrust bridge.

## 1. What we're building

Capture OpenTelemetry from spawned agents alongside the existing ACP event stream, and merge the OTel data into the ACP `_meta` channel so it flows through to the Braintrust bridge.

The motivation is per-LLM-call fidelity in Braintrust — model identity, model params (temperature, top_p, max_tokens, system prompt), per-call prompt/completion/cached tokens, per-call cost, per-call latency. ACP cannot carry this layer because it is outside the protocol's scope; the agent's own OTel HTTP-client and tool spans can.

OTel runs alongside ACP, joined by trace correlation. Each spawn opens a private OTel sink, configures the agent process to export to that sink, and folds collected spans into the ACP event stream's `_meta` before events are emitted to consumers. Existing `_meta` plumbing in [span-builder.ts](packages/braintrust/src/span-builder.ts) carries the data into Braintrust without further changes.

**Non-goals**

- Replacing ACP. OTel is additive.
- Cross-spawn correlation. Each spawn is a self-contained trace context.
- Routing OTel to non-Braintrust backends. The plan ships traces only via the ACP `_meta` path that already targets Braintrust.
- Instrumenting agents that don't emit OTel today (Codex CLI, Kimi, OpenCode if it lacks support). Those keep the current ACP-only fidelity until upstream support lands.

## 2. User-facing shape

_To be drafted next._

## 3. Implementation details and technical decisions

_To be drafted next._

## 4. Interfaces and test plan

_To be drafted next._

## 5. Code plan

_To be drafted next._
