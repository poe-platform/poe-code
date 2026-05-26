# Toolcraft MCP proxy follows symlinked cache directory and writes outside the project

## Summary

Toolcraft MCP proxy discovery persists upstream tool metadata beneath the documented project-local `.toolcraft/mcp` cache directory without rejecting symbolic links. A symlink at that directory redirects generated proxy cache JSON outside the selected project root.

## Reproduction

1. From the repository root, run this disposable probe against the bundled local MCP test server:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-mcp-cache-probe.XXXXXX)
   mkdir -p "$probe/project/.toolcraft" "$probe/outside"
   printf '{"name":"probe"}\n' > "$probe/project/package.json"
   ln -s "$probe/outside" "$probe/project/.toolcraft/mcp"
   cat > "$probe/repro.mts" <<EOF
   import { defineGroup } from "${workspace}/packages/toolcraft/src/index.ts";
   import { resolveMcpProxies } from "${workspace}/packages/toolcraft/src/mcp-proxy.ts";
   const github = defineGroup({
     name: "github",
     mcp: {
       transport: "stdio", command: process.execPath,
       args: ["${workspace}/packages/tiny-stdio-mcp-test-server/dist/cli.js", "serve", "encrypt"]
     },
     children: []
   });
   const root = defineGroup({ name: "root", children: [github] });
   await resolveMcpProxies(root, { projectRoot: "${probe}/project" });
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.toolcraft/mcp"
   cat "$probe/outside/github.json"
   ```

## Observed Behavior

The project-looking MCP cache directory resolves to the external directory, and proxy discovery creates `outside/github.json` containing the upstream tool schema and fetched metadata.

`packages/toolcraft/src/mcp-proxy.ts:507` resolves the documented cache location under `.toolcraft/mcp`, while `packages/toolcraft/src/mcp-proxy.ts:281` through `packages/toolcraft/src/mcp-proxy.ts:287` create and atomically replace a cache entry through that location without canonical-containment or symlink checks. `packages/toolcraft/src/mcp-proxy.ts:557` through `packages/toolcraft/src/mcp-proxy.ts:563` expose the reachable proxy resolution operation.

## Expected Behavior

MCP proxy cache writes should remain beneath the canonical selected project root. A symlinked `.toolcraft/mcp` directory that escapes the project should be rejected rather than followed.

## Impact

A project containing a linked Toolcraft cache directory can cause ordinary CLI, SDK, or MCP proxy initialization to create or replace external JSON files and persist discovered upstream tool metadata outside the project boundary.
