---
name: "Provider Runtime Environment Drops a `__proto__` Configured Variable"
---

# Provider Runtime Environment Drops a `__proto__` Configured Variable

## Summary

The CLI provider-runtime environment resolver silently drops a configured environment variable named `__proto__`. Commands that run configured provider checks use `resolveProviderRuntimeEnv()` to convert provider-declared runtime variables into the process environment, and that conversion writes dynamic names into an ordinary object.

## Reproduction

Create a disposable Vitest probe at `src/cli/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { resolveProviderRuntimeEnv } from "./isolated-env.js";
import { createCliEnvironment } from "./environment.js";

describe("provider runtime environment special names", () => {
  it("drops an explicit __proto__ environment variable", async () => {
    const env = createCliEnvironment({ cwd: "/repo", homeDir: "/home/test", variables: {} });
    const result = await resolveProviderRuntimeEnv(
      env,
      JSON.parse('{"__proto__":"visible"}'),
      "demo-provider"
    );

    expect(Object.hasOwn(result, "__proto__")).toBe(false);
    expect(result).toEqual({});
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/__probe__.test.ts --reporter verbose
```

The probe passes, confirming that a configured runtime variable is discarded. Remove the disposable probe after validation.

## Observed Behavior

`resolveProviderRuntimeEnv()` returns `{}` after receiving a variable map that owns `__proto__: "visible"`; the output contains no own `__proto__` variable. The shared `resolveIsolatedEnvVars()` helper initializes `out` as `{}` and assigns each dynamic key with `out[key] = ...`. This resolver is used when the configured `test` command and Poe command runner assemble provider runtime environment values.

## Expected Behavior

Provider runtime environment configuration should preserve every explicitly declared variable name and resolved string value, including a name such as `__proto__`, or reject unsupported names before silently discarding one.

## Impact

Configured tests and wrapped provider invocations can start with an incomplete environment despite accepted provider configuration. A required special-name environment variable is silently unavailable to the launched command, leading to confusing startup or authentication failures with no validation error.
