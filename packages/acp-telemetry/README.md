# @poe-code/acp-telemetry

Pure ACP event-to-trace conversion plus Braintrust and OpenTelemetry emitters.

## Public Exports

- `acpToTrace(ctx)` converts an `@poe-code/agent-spawn` ACP spawn context into an `AcpTrace`.
- `createTraceSinkMiddleware(sink)` delivers each completed trace to a backend-neutral consumer.
- `emitToBraintrust(trace, parent)` writes the trace as nested Braintrust task/tool spans.
- `emitToOtel(trace, tracer)` writes the trace as OpenTelemetry-style spans and attributes.
- `redact(value)` removes sensitive prompt, tool, and metadata fields before emission.
- Types: `AcpTrace`, `AcpTraceSpan`, `BraintrustSpanLike`, `OtelSpanLike`, `OtelTracerLike`.

## Trace shape

`acpToTrace` creates one root `agent:<agent>:<model>` span with redacted prompt input, accumulated assistant output, token/cost/duration metrics when present, session/thread metadata, and one child span per ACP tool call. Tool child spans include redacted inputs, assembled tool outputs, tool call metadata, and start/end timestamps when the ACP event metadata includes them.

```ts
import { acpToTrace, emitToOtel } from "@poe-code/acp-telemetry";

const trace = acpToTrace(spawnContext);
emitToOtel(trace, tracer);
```

## Emitters

Braintrust emission expects a parent span-like object with `startSpan`, `log`, and `end`. The root is emitted as a `task`; children are emitted as `tool` spans.

OpenTelemetry emission expects a tracer-like object with `startSpan`. Agent spans set `gen_ai.system`, request model, agent name, token usage, and Poe Code session/thread attributes. Tool spans set tool name and tool-call id attributes. Non-primitive inputs and outputs are serialized as JSON attributes.

## Configuration

No env vars, no config.

Failed or aborted spawns still invoke a trace sink once with all trace data captured before failure.
