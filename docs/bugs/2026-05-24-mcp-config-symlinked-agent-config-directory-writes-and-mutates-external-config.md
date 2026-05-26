# MCP configuration follows a symlinked agent config directory and mutates external configuration

## Summary

The exported MCP `configure()` and `unconfigure()` operations resolve fixed agent configuration paths beneath the supplied home directory, but do not validate canonical containment. If the Codex configuration directory `~/.codex` is a symlink to an external directory, normal MCP setup and removal mutate that external `config.toml` file while presenting it as Codex home configuration.

## Reproduction

From the repository root, create a disposable home whose Codex configuration directory points to an external directory, then invoke the public MCP configuration API:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
outside="$probe/outside"
mkdir -p "$home" "$outside"
ln -s "$outside" "$home/.codex"

cat > "$outside/config.toml" <<'EOF'
[unrelated]
keep = true
EOF

cat > "$probe/repro.mts" <<EOF
import * as fs from "node:fs/promises";
import { readFile } from "node:fs/promises";
import { configure, unconfigure } from "file://$PWD/packages/agent-mcp-config/src/index.ts";

const options = { fs: fs as any, homeDir: "$home", platform: "darwin" as const };
await configure(
  "codex",
  { name: "poe-code", config: { transport: "stdio", command: "poe-code", args: ["mcp", "serve"] } },
  options
);
console.log("configured=" + await readFile("$outside/config.toml", "utf8"));
await unconfigure("codex", "poe-code", options);
console.log("unconfigured=" + await readFile("$outside/config.toml", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-mcp-config/src/configs.ts | sed -n '25,44p;101,111p'
nl -ba packages/agent-mcp-config/src/apply.ts | sed -n '144,246p'
nl -ba packages/config-mutations/src/execution/path-utils.ts | sed -n '37,67p'
```

## Observed Behavior

Both lifecycle operations act on `outside/config.toml` through `home/.codex -> outside`:

```text
configured=[unrelated]
keep = true

[mcp_servers.poe-code]
command = "poe-code"
args = [ "mcp", "serve" ]

unconfigured=[unrelated]
keep = true
```

The agent id and MCP server entry are ordinary supported values. The external mutation is caused solely by following the symlinked agent configuration parent directory.

## Expected Behavior

MCP client configuration intended for a selected user home should be written only beneath the canonical supported agent configuration location within that home, or the API should reject symlink-mediated escapes before modifying configuration.

## Impact

A crafted home-directory symlink can redirect MCP setup and cleanup writes into an external TOML configuration file, potentially modifying unrelated user-controlled configuration outside the intended Codex settings location while retaining apparently legitimate MCP operation semantics.
