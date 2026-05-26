# Agent MCP config Goose unconfigure constructor removes empty extensions map for absent server

## Summary

`@poe-code/agent-mcp-config` treats an inherited `constructor` property as an existing Goose MCP extension when unconfiguring YAML state. Calling the exported `unconfigure("goose", "constructor", ...)` API against a config that contains an empty `extensions: {}` map mutates the file by deleting that map, even though no server named `constructor` was configured.

## Reproduction

Add the following disposable test as `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { createMockFs } from "@poe-code/config-mutations/testing";
import { parse as parseYaml } from "yaml";
import { unconfigure } from "./apply.js";

describe("goose inherited MCP server removal", () => {
  it("deletes an empty extensions map when removing absent constructor", async () => {
    const fs = createMockFs(
      { "~/.config/goose/config.yaml": "extensions: {}\nother: keep\n" },
      "/home/test"
    );

    await unconfigure("goose", "constructor", {
      fs,
      homeDir: "/home/test",
      platform: "darwin"
    });

    expect(parseYaml(fs.getContent("/home/test/.config/goose/config.yaml")!)).toEqual({
      other: "keep"
    });
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
```

The test passes:

```text
✓ packages/agent-mcp-config/src/__probe__.test.ts > goose inherited MCP server removal > deletes an empty extensions map when removing absent constructor
```

Remove the disposable probe after confirmation.

## Observed Behavior

For YAML-backed Goose configuration, `removeServer()` reads `extensions` as a normal object and checks membership with `serverName in servers`. With `serverName === "constructor"` and `extensions: {}`, the check succeeds through `Object.prototype.constructor` even though the config has no own `constructor` extension. The subsequent clone has no own entries, so the function deletes `extensions` from the output document and `unconfigure()` writes the changed YAML file.

## Expected Behavior

Unconfiguring a server name that is not an own configured Goose extension should be a no-op. In particular, inherited JavaScript object property names such as `constructor` must not be treated as configured MCP server entries or trigger unrelated YAML changes.

## Impact

Callers using the public unconfiguration API with user-supplied MCP server names can observe false-positive removals and silent configuration churn. This can erase an intentionally present empty `extensions` section, produce misleading change/audit output in higher-level tooling, and makes removal semantics depend on JavaScript prototype property names rather than the persisted Goose configuration.
