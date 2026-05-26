# Poe Agent builtin plugin spec mutation replaces future configured plugin

## Summary

`@poe-code/poe-agent` publicly exports `builtinPluginRegistry` as a `ReadonlyMap`, but the map returns live mutable `PluginSpec` objects. A caller that reads the built-in `web` spec can overwrite its `factory` function, and later `resolvePluginsFromConfig([{ name: "web" }])` calls the replacement factory instead of constructing the intended web plugin. The read-only map wrapper therefore does not protect the process-global built-in plugin behavior it exposes.

## Reproduction

Create a disposable Vitest probe at `packages/poe-agent/src/plugins/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { builtinPluginRegistry } from "./registry.js";
import { resolvePluginsFromConfig } from "./resolve-plugins.js";

describe("poe-agent builtin plugin registry mutation", () => {
  it("does not let registry readers replace later built-in plugin factories", () => {
    const spec = builtinPluginRegistry.get("web");
    if (!spec) {
      throw new Error("Expected built-in web plugin");
    }

    const originalFactory = spec.factory;
    try {
      spec.factory = () => ({ name: "replaced-web-plugin" });

      expect(resolvePluginsFromConfig([{ name: "web" }])[0]?.name).toBe(
        "poe-agent-plugin-web"
      );
    } finally {
      spec.factory = originalFactory;
    }
  });
});
```

Run and remove the probe:

```sh
npm exec -- vitest run packages/poe-agent/src/plugins/__probe__.test.ts --reporter verbose
rm -f packages/poe-agent/src/plugins/__probe__.test.ts
```

## Observed Behavior

The probe fails because the replacement factory supplied through the exported registry is used for the later configured plugin resolution:

```text
FAIL  packages/poe-agent/src/plugins/__probe__.test.ts > poe-agent builtin plugin registry mutation > does not let registry readers replace later built-in plugin factories
AssertionError: expected 'replaced-web-plugin' to be 'poe-agent-plugin-web' // Object.is equality

Expected: "poe-agent-plugin-web"
Received: "replaced-web-plugin"

 ❯ packages/poe-agent/src/plugins/__probe__.test.ts:16:68
```

`builtinPluginRegistry` is constructed from live imported `PluginSpec` objects and exported as a `ReadonlyMap` at `packages/poe-agent/src/plugins/registry.ts:12` through `:31`; the read-only type prevents map mutation but does not make returned spec objects immutable. `resolvePluginsFromConfig()` retrieves that same mutable spec and invokes `spec.factory(parsedOptions)` for future agent configurations at `packages/poe-agent/src/plugins/resolve-plugins.ts:65` through `:93`.

## Expected Behavior

Reading the public built-in plugin registry must not permit mutation of future plugin resolution behavior. Exported specs should be immutable or defensively copied, or the public registry should expose only safe metadata rather than live factory-bearing internal objects.

## Impact

Any in-process integration that inspects available built-in plugins can accidentally or deliberately replace plugin construction for subsequent agent sessions. A configured `web` plugin can silently become an unrelated plugin with different tools, hooks, or providers, altering agent behavior and bypassing assumptions made by configuration validation and callers.
