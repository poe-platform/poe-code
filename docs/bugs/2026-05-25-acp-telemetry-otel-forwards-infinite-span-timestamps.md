# ACP telemetry OTEL forwards infinite span timestamps

## Summary

The exported `@poe-code/acp-telemetry` `emitToOtel()` API accepts an `AcpTrace` whose span timestamps are typed as numbers and forwards `Infinity` directly into OpenTelemetry span lifecycle calls. A trace with `startTs: Infinity` and `endTs: Infinity` causes the tracer to receive an infinite start time and infinite end time rather than rejecting or omitting invalid timing metadata.

## Reproduction

Create a disposable Vitest probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitToOtel } from "./emit-otel.js";

describe("ACP OTel non-finite timestamps", () => {
  it("forwards infinite trace timestamps into tracer lifecycle calls", () => {
    const calls: unknown[] = [];
    emitToOtel({
      root: {
        name: "agent:codex:gpt",
        kind: "agent",
        startTs: Infinity,
        endTs: Infinity,
        children: [],
      },
    }, {
      startSpan(name, options) {
        calls.push({ name, options });
        return {
          setAttribute() {},
          setAttributes() {},
          end(endTime) {
            calls.push({ endTime });
          },
        };
      },
    });

    console.log(JSON.stringify({
      start: String((calls[0] as { options: { startTime: number } }).options.startTime),
      end: String((calls[1] as { endTime: number }).endTime),
    }));
    expect((calls[0] as { options: { startTime: number } }).options.startTime).toBe(Infinity);
    expect((calls[1] as { endTime: number }).endTime).toBe(Infinity);
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/acp-telemetry/src/__probe__.test.ts --reporter verbose
rm -f packages/acp-telemetry/src/__probe__.test.ts
```

The probe prints:

```text
{"start":"Infinity","end":"Infinity"}
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP OTel non-finite timestamps > forwards infinite trace timestamps into tracer lifecycle calls
```

## Observed Behavior

`packages/acp-telemetry/src/emit-otel.ts` starts each span with `traceSpan.startTs !== undefined ? { startTime: traceSpan.startTs } : undefined` and ends it with `span.end(traceSpan.endTs)` whenever an end timestamp exists. Unlike the trace converter's finite-number reader, the public emitter itself performs no finiteness validation. Passing a directly constructed public `AcpTrace` with infinite timestamp values forwards both unsupported times unchanged into the tracer implementation.

## Expected Behavior

The OpenTelemetry emitter should accept only finite timestamps for span timing, omitting or rejecting non-finite values before invoking tracer lifecycle operations. Invalid numerical timestamps must not be presented to telemetry backends as real timing data.

## Impact

Callers using the public trace-emission API directly, or code that constructs or transforms trace objects after conversion, can send impossible timing values to OpenTelemetry SDKs and exporters. Depending on the backend, this can reject telemetry export, emit corrupted durations, or produce spans that cannot be ordered or analyzed reliably.
