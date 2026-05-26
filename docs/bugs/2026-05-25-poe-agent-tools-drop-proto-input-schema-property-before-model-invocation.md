# Poe Agent Tools Drop a `__proto__` Input Schema Property Before Model Invocation

## Summary

The public `@poe-code/poe-agent` builder accepts a tool input schema whose `properties` object explicitly owns `__proto__`, but silently removes that declared property before presenting the tool definition to the model. The builder's defensive schema clone copies arbitrary nested keys into ordinary objects with bracket assignment.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { agent } from "./agent.js";
import { toAcpModelResponse } from "./testing/model-response.js";

describe("poe-agent tool input schema special keys", () => {
  it("drops an explicit __proto__ schema property before model invocation", async () => {
    const capturedSchemas: unknown[] = [];
    const model = {
      complete: vi.fn(async (request: { tools: Array<{ inputSchema?: unknown }> }) => {
        capturedSchemas.push(request.tools[0]?.inputSchema);
        return toAcpModelResponse({ message: { content: "done", toolCalls: [] } });
      })
    } as never;

    await agent()
      .model("demo")
      .tools({
        name: "inspect",
        call: () => "ok",
        inputSchema: JSON.parse('{"type":"object","properties":{"__proto__":{"type":"string"}}}')
      } as never)
      .run("hello", { acpModel: model });

    const properties = (capturedSchemas[0] as { properties: Record<string, unknown> }).properties;
    expect(Object.hasOwn(properties, "__proto__")).toBe(false);
    expect(properties).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/poe-agent/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the schema sent to the model no longer contains the explicitly declared field. Remove the disposable probe after validation.

## Observed Behavior

After `.tools(...)` receives a schema with an own `properties.__proto__` declaration, the model's `complete()` request observes `inputSchema.properties` as `{}`. `cloneAgentPlugin()` clones tool input schemas through `cloneUnknown()`, which initializes every object clone as `{}` and assigns arbitrary nested keys via `cloned[key] = cloneUnknown(entry)`. `runAcpCore()` then forwards this already-damaged schema to the model.

## Expected Behavior

Tool schema definitions accepted by the public builder should be preserved when forwarded to the model, including data property names such as `__proto__`, or unsupported schema property names should be rejected explicitly during configuration.

## Impact

Models are shown a tool contract different from the one configured by the caller. A tool argument property can disappear silently, preventing the model from supplying valid inputs and causing unexplained tool-use failures or missing capabilities during agent runs.
