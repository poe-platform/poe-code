---
name: "Agent Script Pending Host Policy `__proto__` Module Registration Pollutes `Object.prototype`"
---

# Agent Script Pending Host Policy `__proto__` Module Registration Pollutes `Object.prototype`

## Summary

The exported `@poe-code/agent-script` `registerPendingHostCallPolicy()` API accepts a policy registration whose `moduleId` is `__proto__` and writes its operation directly onto `Object.prototype`. The registered policy can then be resolved for that module, but the registration also leaks a new inherited property into ordinary objects throughout the process.

## Reproduction

Create a disposable Vitest probe at `packages/agent-script/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it } from "vitest";
import {
  registerPendingHostCallPolicy,
  resolvePendingHostCallIssuePolicy
} from "./snapshot/policy.js";

describe("agent-script snapshot policy prototype module id repro", () => {
  afterEach(() => {
    delete (Object.prototype as Record<string, unknown>).dangerousOperation;
  });

  it("writes a __proto__ module registration onto Object.prototype", () => {
    registerPendingHostCallPolicy({
      moduleId: "__proto__",
      operation: "dangerousOperation",
      policy: "read-side-effect"
    });

    expect(({} as Record<string, unknown>).dangerousOperation).toBe("read-side-effect");
    expect(resolvePendingHostCallIssuePolicy({
      id: "call-1",
      moduleId: "__proto__",
      operation: "dangerousOperation"
    }).kind).toBe("read-side-effect");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-script/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that the public registration operation installs an inherited property visible on an unrelated ordinary object. Remove the disposable probe after validation.

## Observed Behavior

After `registerPendingHostCallPolicy({ moduleId: "__proto__", operation: "dangerousOperation", policy: "read-side-effect" })`, evaluating `({}).dangerousOperation` returns `"read-side-effect"`. The policy resolver also returns the registered mode for a pending call carrying the accepted `moduleId`. In `packages/agent-script/src/snapshot/policy.ts`, the global policy registry is an ordinary object and registration evaluates `MODULE_PENDING_HOST_CALL_POLICIES[moduleId] ??= {}` followed by `MODULE_PENDING_HOST_CALL_POLICIES[moduleId][operation] = policy`; when `moduleId` is `__proto__`, the second assignment writes onto the inherited `Object.prototype` object.

## Expected Behavior

Pending host call policy registration should isolate module and operation identifiers as inert registry keys. Accepting a module identifier such as `__proto__` must not modify JavaScript global prototypes, or such identifiers should be rejected before registration.

## Impact

A consumer of the public Agent Script policy extension API can unintentionally or maliciously introduce inherited properties onto every normal object in the host process. This can corrupt unrelated object lookups, validations, serialization decisions, or control flow outside the snapshot subsystem while appearing to perform an ordinary policy registration.
