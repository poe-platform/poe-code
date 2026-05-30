---
name: "Toolcraft MCP proxy group name traversal writes cache outside the project"
---

# Toolcraft MCP proxy group name traversal writes cache outside the project

## Summary

Toolcraft MCP proxy discovery derives its project-local cache filename directly from a proxy group's configured `name`. A group name containing `../` segments escapes `.toolcraft/mcp` and can write generated upstream tool metadata outside the selected project root.

## Reproduction

1. From the repository root, run this disposable probe against the bundled local MCP test server:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-mcp-name-traversal-probe.XXXXXX)
   mkdir -p "$probe/project/.toolcraft/mcp" "$probe/outside"
   printf '{"name":"probe"}\n' > "$probe/project/package.json"
   cat > "$probe/repro.mts" <<EOF
   import { defineGroup } from "${workspace}/packages/toolcraft/src/index.ts";
   import { resolveMcpProxies } from "${workspace}/packages/toolcraft/src/mcp-proxy.ts";
   const proxy = defineGroup({
     name: "../../../outside/escaped",
     mcp: {
       transport: "stdio", command: process.execPath,
       args: ["${workspace}/packages/tiny-stdio-mcp-test-server/dist/cli.js", "serve", "encrypt"]
     },
     children: []
   });
   const root = defineGroup({ name: "root", children: [proxy] });
   await resolveMcpProxies(root, { projectRoot: "${probe}/project" });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/outside/escaped.json"
   cat "$probe/outside/escaped.json"
   ```

## Observed Behavior

Proxy discovery succeeds and creates `outside/escaped.json`, outside `project/.toolcraft/mcp` and outside the selected project root, containing fetched upstream tool metadata.

`packages/toolcraft/src/mcp-proxy.ts:412` uses the group `name` as the cache key, and `packages/toolcraft/src/mcp-proxy.ts:498` through `packages/toolcraft/src/mcp-proxy.ts:507` interpolate it into a filesystem path with no containment validation. `packages/toolcraft/src/mcp-proxy.ts:281` through `packages/toolcraft/src/mcp-proxy.ts:287` then write the escaped cache file.

## Expected Behavior

MCP proxy group names used for cache persistence should be encoded as safe single filenames or rejected if they contain path components. Cache writes must remain beneath the canonical `.toolcraft/mcp` directory.

## Impact

An application declaring an MCP proxy group with a traversal name can cause routine Toolcraft CLI, SDK, or MCP initialization to create or replace arbitrary JSON files outside its intended project cache boundary.
