# ACP telemetry OTEL converts infinite scalar output to null string

## Summary

The exported `@poe-code/acp-telemetry` OpenTelemetry emitter rejects non-finite numbers from its primitive-attribute path, but then falls back to `JSON.stringify()` for the same scalar value. An ACP trace span whose output is `Infinity` is therefore emitted with `poe_code.output: "null"`, silently changing an invalid/non-finite numeric result into a string that appears to describe a literal null output.

## Reproduction

Create a disposable Vitest probe at `packages/acp-telemetry/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { emitToOtel } from "./emit-otel.js";

describe("ACP OTel non-finite output", () => {
  it("emits an infinite scalar output as the unrelated string null", () => {
    const attrs: Record<string, unknown>[] = [];
    emitToOtel({
      root: { name: "agent:codex:gpt", kind: "agent", output: Infinity, children: [] },
    }, {
      startSpan() {
        return {
          setAttribute() {},
          setAttributes(value) {
            attrs.push(value);
          },
          end() {},
        };
      },
    });

    const output = attrs[0]?.["poe_code.output"];
    console.log(JSON.stringify({ output, type: typeof output }));
    expect(output).toBe("null");
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
{"output":"null","type":"string"}
✓ packages/acp-telemetry/src/__probe__.test.ts > ACP OTel non-finite output > emits an infinite scalar output as the unrelated string null
```

## Observed Behavior

`packages/acp-telemetry/src/emit-otel.ts` maps span inputs and outputs through `addInputOutputAttribute()`. Its `readPrimitive()` helper admits only finite numbers, so `Infinity` is not recorded as a number. The fallback immediately applies `JSON.stringify(value)`, which serializes a standalone non-finite number as `"null"`; that resulting text is installed as the OpenTelemetry attribute. The emitted trace now represents an infinite output as a string-valued null marker rather than preserving or rejecting the malformed metric/output condition.

## Expected Behavior

Non-finite scalar input or output values should be rejected, omitted, or represented through an explicit error/redaction marker. They must not be silently serialized into a different ordinary value whose type and meaning are unrelated to the source span payload.

## Impact

Telemetry consumers can observe incorrect trace output when an ACP event or derived span contains a non-finite scalar, obscuring upstream data-quality failures and making diagnostics misleading. Queries, dashboards, audits, or replay tooling may conclude that a tool or agent returned textual `null` output when the actual payload was an unsupported overflowing numeric value.
