# Agent Maestro `__proto__` State Becomes an Inherited Active State

## Summary

The public Agent Maestro configuration resolver accepts a workflow state named `__proto__`, but stores its definition as the prototype of the returned `states` object rather than as an own configured state. Subsequent active-state derivation still reads that inherited prompt and lists the state as active.

## Reproduction

Create a disposable Vitest probe at `packages/agent-maestro/src/config/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveConfig } from "./schema.js";

describe("maestro workflow special state names", () => {
  it("turns an explicit __proto__ workflow state into inherited active state", () => {
    const config = resolveConfig({
      states: JSON.parse('{"__proto__":{"prompt":"Run this state."}}')
    }, "/repo");

    expect(Object.hasOwn(config.states, "__proto__")).toBe(false);
    expect(config.stateOrder).toEqual(["__proto__"]);
    expect(config.activeStateNames).toEqual(["__proto__"]);
    expect(config.states.__proto__).toEqual({ prompt: "Run this state." });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-maestro/src/config/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the accepted state is represented through inheritance rather than explicit configuration data. Remove the disposable probe after validation.

## Observed Behavior

`resolveConfig()` returns `stateOrder` and `activeStateNames` containing `"__proto__"`, while `Object.hasOwn(config.states, "__proto__")` is `false`; reading `config.states.__proto__` yields the configured prompt object from the object's prototype. In `packages/agent-maestro/src/config/schema.ts`, `parseStates()` initializes `states` as `{}` and assigns each dynamic state name through `states[stateName] = parseStateDefinition(definition)`, then active-state filtering reads `states[name]?.prompt` without requiring ownership.

## Expected Behavior

Each accepted workflow state should be represented as an own entry in `config.states` and used consistently by workflow validation and execution, including a data key such as `__proto__`, or special names should be rejected explicitly during parsing.

## Impact

Workflow configuration loses structural integrity: enumerating configured state entries disagrees with state-order and active-state results, while downstream logic acts on inherited prototype data as if it were declared workflow state. This can cause incorrect dispatch, auditing, or state-machine behavior for accepted configurations.
