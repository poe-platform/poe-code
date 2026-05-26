# Agent MCP Config Goose Failed Configure Write Corrupts Prior YAML Config

## Summary

The exported `@poe-code/agent-mcp-config` Goose configuration path handles YAML separately from the shared mutation executor and overwrites `~/.config/goose/config.yaml` directly. If a configure write partially modifies that file and then rejects, the prior valid Goose MCP extension configuration is destroyed.

## Reproduction

Create a disposable Vitest probe at `packages/agent-mcp-config/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { configure } from "./apply.js";
import type { ApplyOptions } from "./types.js";

describe("goose MCP config interrupted write", () => {
  it("destroys prior valid YAML configuration when a configure write rejects", async () => {
    const configPath = "/home/user/.config/goose/config.yaml";
    const base = createFsFromVolume(Volume.fromJSON({
      [configPath]: "extensions:\n  old:\n    name: old\n    cmd: old-command\n",
    })).promises as unknown as ApplyOptions["fs"];
    const fs: ApplyOptions["fs"] = {
      ...base,
      async writeFile(filePath, data, options) {
        if (filePath === configPath) {
          await base.writeFile(filePath, "extensions: [", options);
          throw new Error("goose config disk full");
        }
        await base.writeFile(filePath, data, options);
      },
    };

    await expect(configure("goose", { name: "new", config: { transport: "stdio", command: "new-command" } }, {
      fs, homeDir: "/home/user", platform: "linux", dryRun: false,
    })).rejects.toThrow("goose config disk full");
    const raw = await base.readFile(configPath, "utf8");
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("extensions: [");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"extensions: ["}
✓ packages/agent-mcp-config/src/__probe__.test.ts > goose MCP config interrupted write > destroys prior valid YAML configuration when a configure write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

For YAML-backed agents, `writeYamlConfig()` writes serialized replacement state directly to the live config file at `packages/agent-mcp-config/src/apply.ts:114`. `configure("goose", ...)` reads existing extensions, merges the requested server, and invokes that direct writer at `packages/agent-mcp-config/src/apply.ts:171`. In the probe, the public configure call rejects after truncating the prior valid Goose document to malformed YAML `"extensions: ["`.

## Expected Behavior

Goose MCP configuration updates should preserve the last valid YAML document when a replacement cannot be completely persisted. The YAML path should receive the same atomic or recoverable write guarantees expected for configuration mutation operations.

## Impact

A disk-full event or interrupted write while adding or replacing one Goose MCP server can destroy all previously configured Goose extensions. Later Goose startup or MCP management cannot reliably parse existing configuration, and the failed setup operation leaves the user's original server definitions unrecoverable from the live file.
