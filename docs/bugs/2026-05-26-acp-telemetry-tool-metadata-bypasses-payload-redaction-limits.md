# ACP telemetry tool metadata bypasses payload redaction limits

## Summary

The exported `@poe-code/acp-telemetry` `acpToTrace()` converter applies its size and binary redaction policy to tool inputs and outputs but not to tool `_meta` values. Oversized runtime data preserved in tool metadata is copied verbatim into the generated span and passed onward to telemetry emitters, even when the same data used as a tool input is replaced with a truncation marker.

## Reproduction

From the repository root, create and execute this disposable Vitest probe, then remove it:

```sh
cat > packages/acp-telemetry/src/__probe__.test.ts <<'EOF'
import { expect, it } from "vitest";
import { acpToTrace } from "./index.js";

it("preserves oversized tool metadata while redacting oversized tool input", () => {
  const large = "x".repeat(65_537);
  const trace = acpToTrace({
    agent: "codex",
    model: "gpt",
    prompt: "run",
    cwd: "/repo",
    usage: {},
    events: [
      {
        sessionUpdate: "tool_call",
        toolCallId: "tool-1",
        kind: "shell",
        rawInput: large,
        _meta: { raw: large }
      }
    ]
  } as never);

  expect(trace.root.children[0]!.input).toBe("[truncated:65537]");
  expect(trace.root.children[0]!.metadata?.raw).toBe(large);
});
EOF
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
rm -f packages/acp-telemetry/src/__probe__.test.ts
```

The probe passes:

```text
✓ packages/acp-telemetry/src/__probe__.test.ts > preserves oversized tool metadata while redacting oversized tool input
Test Files  1 passed (1)
Tests       1 passed (1)
```

## Observed Behavior

A tool-call event containing the same 65,537-character value as both `rawInput` and `_meta.raw` converts into a child span whose `input` equals `"[truncated:65537]"`, while `metadata.raw` still equals the complete unbounded string.

The package defines its redaction limits in `packages/acp-telemetry/src/redact.ts:1` through `packages/acp-telemetry/src/redact.ts:44`. In trace construction, tool inputs and outputs explicitly pass through `redact()` at `packages/acp-telemetry/src/trace.ts:50` through `packages/acp-telemetry/src/trace.ts:69`. In contrast, `collectToolMeta()` copies every `_meta` value directly into a normal metadata object at `packages/acp-telemetry/src/trace.ts:74` through `packages/acp-telemetry/src/trace.ts:100`, and that object is attached without redaction. The Braintrust emitter subsequently forwards span metadata verbatim at `packages/acp-telemetry/src/emit-braintrust.ts:38` through `packages/acp-telemetry/src/emit-braintrust.ts:47`.

## Expected Behavior

Telemetry redaction and payload-size safeguards should apply consistently to arbitrary tool-provided data regardless of whether it appears in input, output, or metadata fields. If `_meta` is intentionally exempt, the API should constrain it to safe operational metadata rather than forwarding arbitrary oversized values unbounded.

## Impact

Tool adapters or ACP events that place raw payloads, prompts, responses, binary fragments, or secret-bearing context into `_meta` can bypass the telemetry package's advertised safety boundary. Observability backends may receive unexpectedly large or sensitive metadata despite inputs and outputs being truncated or binary-redacted, increasing disclosure, storage, and logging risk.
