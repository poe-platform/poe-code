# Toolcraft MCP proxy follows symlinked cache file and loads external tools

## Summary

Toolcraft MCP proxy discovery reads a cached upstream tool manifest from the documented project-local `.toolcraft/mcp/<name>.json` path without rejecting symbolic links. A symlinked cache entry can therefore load an external manifest as project-owned proxy configuration.

## Reproduction

1. From the repository root, run this disposable probe. The configured upstream command cannot execute, demonstrating that the external cache is used directly:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-mcp-cache-read-probe.XXXXXX)
   mkdir -p "$probe/project/.toolcraft/mcp"
   printf '{"name":"probe"}\n' > "$probe/project/package.json"
   cat > "$probe/outside-cache.json" <<'EOF'
   {"$schema":"https://poe-platform.github.io/poe-code/schemas/toolcraft/mcp-proxy.schema.json","version":1,"fetchedAt":"2026-05-24T00:00:00.000Z","upstream":{"name":"external","version":"1"},"tools":[{"name":"external_command","description":"from outside","inputSchema":{"type":"object","properties":{},"additionalProperties":false}}]}
   EOF
   ln -s "$probe/outside-cache.json" "$probe/project/.toolcraft/mcp/github.json"
   cat > "$probe/repro.mts" <<EOF
   import { defineGroup } from "${workspace}/packages/toolcraft/src/index.ts";
   import { resolveMcpProxies } from "${workspace}/packages/toolcraft/src/mcp-proxy.ts";
   const root = defineGroup({
     name: "root",
     children: [defineGroup({
       name: "github", mcp: { transport: "stdio", command: "/definitely/not/executable" }, children: []
     })]
   });
   await resolveMcpProxies(root, { projectRoot: "${probe}/project" });
   const github = root.children[0];
   console.log(github.kind === "group" ? github.children.map((child) => child.name).join(",") : "not-group");
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.toolcraft/mcp/github.json"
   ```

## Observed Behavior

The proxy cache path resolves to `outside-cache.json`, and `resolveMcpProxies()` prints `external_command` without trying the invalid upstream executable. The external manifest is accepted as the tool list for the project-local `github` proxy group.

`packages/toolcraft/src/mcp-proxy.ts:247` through `packages/toolcraft/src/mcp-proxy.ts:278` read and parse the cache file without symlink validation, while `packages/toolcraft/src/mcp-proxy.ts:419` through `packages/toolcraft/src/mcp-proxy.ts:424` prefer cached content over discovery when no refresh is requested.

## Expected Behavior

MCP proxy cached tool manifests should only be loaded from validated regular files beneath the canonical project cache directory. Symlinked entries that resolve outside that directory should be rejected.

## Impact

A project-local symlink can inject arbitrary external MCP tool names and schemas into Toolcraft command surfaces, altering available CLI, SDK, or MCP operations without contacting the configured upstream server.
