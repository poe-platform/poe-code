# MCP configuration overwrites or deletes user-owned server entry

## Summary

Running `mcp unconfigure <agent>` deletes any MCP server entry named `poe-code`, even when Poe Code never configured or tracked that entry and its command is unrelated user-owned configuration. Additionally, `mcp configure` silently overwrites a pre-existing user-owned entry with the same name and a later unconfigure removes it instead of restoring the original. Deletion reproduces for Claude Code, Codex, OpenCode, Kimi, and Goose; overwrite-and-loss is demonstrated with Codex.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: local TypeScript CLI entrypoint with disposable home/project directories and hand-authored MCP client configuration files

## Reproduction

From the repository root, create user-owned MCP entries named `poe-code` whose commands do not invoke Poe Code, then unconfigure each client without any Poe Code MCP ownership metadata:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/claude/home" "$probe/claude/project" \
  "$probe/codex/home/.codex" "$probe/codex/project" \
  "$probe/open/home/.config/opencode" "$probe/open/project" \
  "$probe/kimi/home/.kimi" "$probe/kimi/project" \
  "$probe/goose/home/.config/goose" "$probe/goose/project"
cat > "$probe/claude/home/.claude.json" <<'EOF'
{"mcpServers":{"poe-code":{"command":"user-custom-command","args":["not-poe-code"]},"other":{"command":"keep"}}}
EOF
cat > "$probe/codex/home/.codex/config.toml" <<'EOF'
[mcp_servers.poe-code]
command = "user-custom-command"
args = ["not-poe-code"]

[mcp_servers.other]
command = "keep"
EOF
cat > "$probe/open/home/.config/opencode/opencode.json" <<'EOF'
{"mcp":{"poe-code":{"type":"local","command":["user-custom-command"],"enabled":true},"other":{"type":"local","command":["keep"],"enabled":true}}}
EOF
cat > "$probe/kimi/home/.kimi/mcp.json" <<'EOF'
{"mcpServers":{"poe-code":{"command":"user-custom-command"},"other":{"command":"keep"}}}
EOF
cat > "$probe/goose/home/.config/goose/config.yaml" <<'EOF'
extensions:
  poe-code:
    type: stdio
    cmd: user-custom-command
  other:
    type: stdio
    cmd: keep
EOF
run() {
  name=$1
  service=$2
  (
    cd "$probe/$name/project" &&
    HOME="$probe/$name/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes mcp unconfigure "$service"
  )
}
run claude claude-code
run codex codex
run open opencode
run kimi kimi
run goose goose
cat "$probe/claude/home/.claude.json"
cat "$probe/codex/home/.codex/config.toml"
cat "$probe/open/home/.config/opencode/opencode.json"
cat "$probe/kimi/home/.kimi/mcp.json"
cat "$probe/goose/home/.config/goose/config.yaml"
```

To demonstrate overwrite-and-loss rather than direct deletion, create a user-owned Codex server entry, configure Poe Code MCP, then remove it:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.codex" "$probe/project"
cat > "$probe/home/.codex/config.toml" <<'EOF'
[mcp_servers.poe-code]
command = "user-original-command"
args = ["user-arg"]

[mcp_servers.other]
command = "keep"
EOF
cat > "$probe/fetch-preload.mjs" <<'EOF'
globalThis.fetch = async () => new Response(
  JSON.stringify({ email: 'probe@example.invalid', current_point_balance: 1 }),
  { status: 200, headers: { 'content-type': 'application/json' } }
);
EOF
run() {
  (
    cd "$probe/project" &&
    HOME="$probe/home" \
      "$repo/node_modules/.bin/tsx" \
      --import "$probe/fetch-preload.mjs" \
      --import "$repo/scripts/register-template-loader.mjs" \
      "$repo/src/index.ts" --yes "$@"
  )
}
run login --api-key stored-mcp-key
cat "$probe/home/.codex/config.toml"
run mcp configure codex --yes
cat "$probe/home/.codex/config.toml"
run mcp unconfigure codex
cat "$probe/home/.codex/config.toml"
```

## Observed Behavior

- Every `mcp unconfigure` invocation reports `Removed MCP configuration from <agent>.`.
- Claude Code deletes user-owned `mcpServers["poe-code"]` while retaining the unrelated `other` entry.
- Codex deletes the entire user-owned `[mcp_servers.poe-code]` TOML table while retaining `[mcp_servers.other]`.
- OpenCode deletes the user-owned `mcp["poe-code"]` object while retaining `mcp.other`.
- Kimi deletes the user-owned `mcpServers["poe-code"]` object while retaining `other`.
- Goose deletes the user-owned `extensions.poe-code` YAML extension while retaining `extensions.other`.
- When a user-owned Codex `[mcp_servers.poe-code]` entry contains `command = "user-original-command"`, `mcp configure codex` replaces it with Poe Code's generated `npm ... mcp serve` command; a subsequent `mcp unconfigure codex` deletes the entry entirely rather than restoring the original command and arguments.

## Expected Behavior

MCP configuration must not irreversibly replace arbitrary user-owned entries solely because their chosen server name is `poe-code`; if replacement is intentional, unconfiguration must restore the pre-existing entry. MCP unconfiguration must remove only an entry that Poe Code created or can prove matches its generated configuration.

## Impact

- Users can lose unrelated MCP integrations either by direct unconfigure or by configure-then-unconfigure replacement of a colliding entry.
- The destructive operation occurs without prior Poe Code configuration or ownership records.
- Recovery requires manually reconstructing each affected MCP client's server command and options.

## Supporting Evidence

In `src/cli/commands/mcp.ts`, MCP operations always use the server name `poe-code` without tracking whether Poe Code previously installed an entry. In `packages/agent-mcp-config/src/apply.ts`, `configure(...)` replaces the server entry at that key, while `unconfigure(...)` removes it by name only for JSON, TOML, and YAML formats, without validating its value, recording an overwritten entry, or enforcing ownership.

## Suspected Area

MCP configuration needs ownership-aware installation and cleanup, including backup/restoration or exact generated-entry matching for colliding named MCP server entries.
