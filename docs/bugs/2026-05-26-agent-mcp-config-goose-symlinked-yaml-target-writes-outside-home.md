# Agent MCP Config Goose symlinked YAML target writes outside home

## Summary

The exported `@poe-code/agent-mcp-config` `configure()` API writes Goose MCP configuration through a YAML-specific path that expands `~/.config/goose/config.yaml` textually but does not enforce canonical home containment. If that normal home-relative configuration file is a symbolic link to an external YAML file, configuring a Goose MCP server reads and overwrites the external file while reporting ordinary success.

## Reproduction

From the repository root, create and run this disposable in-memory Vitest probe:

```sh
cat > packages/agent-mcp-config/src/__probe__.test.ts <<'EOF'
import { vol, fs as memoryFs } from "memfs";
import { afterEach, describe, expect, it } from "vitest";
import { configure } from "./apply.js";
import type { ApplyOptions, McpServerEntry } from "./types.js";

describe("Goose YAML target symlink containment", () => {
  afterEach(() => {
    vol.reset();
  });

  it("writes Goose MCP config through a home symlink into an external YAML file", async () => {
    const targetPath = "/home/test/.config/goose/config.yaml";
    const outsidePath = "/outside/config.yaml";
    vol.fromJSON({ [outsidePath]: "extensions:\n  existing:\n    type: stdio\n    cmd: old\n" }, "/");
    vol.mkdirSync("/home/test/.config/goose", { recursive: true });
    vol.symlinkSync(outsidePath, targetPath);
    const options: ApplyOptions = {
      fs: memoryFs.promises as never,
      homeDir: "/home/test",
      platform: "linux"
    };
    const server: McpServerEntry = {
      name: "poe-code",
      config: { transport: "stdio", command: "npx", args: ["poe-code", "mcp"] }
    };

    await configure("goose", server, options);

    const outside = vol.readFileSync(outsidePath, "utf8") as string;
    console.log(JSON.stringify({ outside, targetIsSymlink: vol.lstatSync(targetPath).isSymbolicLink() }));
    expect(outside).toContain("existing:");
    expect(outside).toContain("poe-code:");
    expect(vol.lstatSync(targetPath).isSymbolicLink()).toBe(true);
  });
});
EOF
npm exec -- vitest run packages/agent-mcp-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-mcp-config/src/__probe__.test.ts
```

The probe passes and prints:

```text
{"outside":"extensions:\n  existing:\n    type: stdio\n    cmd: old\n  poe-code:\n    type: stdio\n    cmd: npx\n    args:\n      - poe-code\n      - mcp\n","targetIsSymlink":true}
```

## Observed Behavior

`configure("goose", ...)` reads the pre-existing external YAML document through the symlink, preserves its `existing` extension, adds the new `poe-code` extension, and writes the merged YAML back into `/outside/config.yaml`. The requested configuration path still exists only as a symlink, while the API completes without indicating an out-of-home mutation.

For YAML-format agents, `configure()` selects a special branch at `packages/agent-mcp-config/src/apply.ts:144` through `packages/agent-mcp-config/src/apply.ts:190` instead of using the shared config-mutation executor. `readYamlConfig()` and `writeYamlConfig()` construct the filesystem destination by simple home expansion at `packages/agent-mcp-config/src/apply.ts:87` through `packages/agent-mcp-config/src/apply.ts:117`; neither checks whether the resulting path resolves through a symbolic link outside `options.homeDir` before reading or writing.

## Expected Behavior

Configuring a home-scoped Goose MCP server should modify only the canonical Goose configuration file inside the selected home directory. A symlinked YAML target that resolves outside that boundary should be rejected before any external content is read or overwritten.

## Impact

A manipulated home-directory layout or local attacker able to plant the Goose configuration symlink can redirect routine MCP setup into an arbitrary writable YAML file outside the home-scoped configuration location. Existing external configuration is ingested and altered while the caller believes only Goose MCP state was updated.
