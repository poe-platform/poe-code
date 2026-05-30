---
name: "Agent Script Log Event Drops a `__proto__` Payload Field From JSONL"
---

# Agent Script Log Event Drops a `__proto__` Payload Field From JSONL

## Summary

The exported Agent Script `makeLogModule()` default JSONL logger silently drops an event payload field named `__proto__`. When it normalizes arbitrary user payload objects for JSON output, it copies dynamic keys into an ordinary object, so the field is not emitted as log data.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/modules/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { makeLogModule } from "./log.js";

describe("agent script JSONL special object keys", () => {
  it("drops an explicit __proto__ event payload field in default output", () => {
    const write = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    try {
      makeLogModule().event("audit", JSON.parse('{"__proto__":{"visible":"lost"}}'));
      const line = String(write.mock.calls[0]?.[0]);
      const payload = JSON.parse(line).payload as Record<string, unknown>;
      expect(Object.hasOwn(payload, "__proto__")).toBe(false);
      expect(payload).toEqual({});
    } finally {
      write.mockRestore();
    }
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/modules/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the default JSONL output omits the supplied payload field. Remove the disposable probe after validation.

## Observed Behavior

Calling `makeLogModule().event()` with a payload owning `__proto__` writes a JSONL event whose parsed `payload` is `{}` and has no own special-key field. In `packages/agent-script/src/modules/log.ts`, the default sink serializes `toJsonValue(entry, ...)`; its object path initializes `normalized` as `{}` and writes every user object property via `normalized[key] = toJsonValue(entry, seen)`.

## Expected Behavior

The default log serializer should faithfully preserve accepted user payload properties as inert JSON log data, including `__proto__`, or reject unsupported keys explicitly rather than silently emitting incomplete event content.

## Impact

Agent scripts can emit audit, diagnostic, or workflow events whose payloads are silently incomplete in JSONL logs. Downstream tooling and forensic analysis may miss user-supplied fields while the logging call appears to succeed normally.
