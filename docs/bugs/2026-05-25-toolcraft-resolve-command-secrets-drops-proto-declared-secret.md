# Toolcraft `resolveCommandSecrets` Drops a `__proto__` Declared Secret

## Summary

The exported Toolcraft `resolveCommandSecrets()` API accepts a command with a declared secret named `__proto__`, resolves its configured environment value, but silently omits that secret from the returned secrets object. Its output assembly assigns dynamic secret names into an ordinary object.

## Reproduction

Create a disposable Vitest probe at `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { defineCommand, resolveCommandSecrets } from "./index.js";

describe("command special secret names", () => {
  it("drops a declared __proto__ secret from resolved command secrets", () => {
    const command = defineCommand({
      name: "deploy",
      secrets: JSON.parse('{"__proto__":{"env":"TOKEN"}}'),
      handler: async () => undefined
    } as never);

    const secrets = resolveCommandSecrets(command, { TOKEN: "visible" });
    expect(Object.hasOwn(secrets, "__proto__")).toBe(false);
    expect(secrets).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a successfully resolved declared secret is not returned. Remove the disposable probe after validation.

## Observed Behavior

`resolveCommandSecrets()` returns `{}` for a command that owns a `__proto__` secret declaration backed by `TOKEN: "visible"`. `defineCommand()` retains the declaration through `cloneSecrets()` using `Object.fromEntries()`, but `resolveCommandSecrets()` creates `secrets = {}` and writes each resolved declaration through `secrets[name] = value`, causing the special key not to exist as returned secret data.

## Expected Behavior

Resolved command secrets should contain every accepted declared secret key and its resolved value, including a data key named `__proto__`, or such names should be rejected explicitly when a command is defined.

## Impact

Toolcraft handlers can be invoked without a secret they declared and for which the required environment credential was successfully supplied. This creates a silent mismatch between command configuration and runtime secret access, causing incorrect authentication or handler behavior.
