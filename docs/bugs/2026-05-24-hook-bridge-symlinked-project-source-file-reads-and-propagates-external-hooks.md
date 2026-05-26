# Hook bridging follows a symlinked project source file and propagates external hooks

## Summary

`readClaudeHooks()` and `bridgeHooks()` treat `<cwd>/.claude/settings.json` as project-scoped hook input without verifying its canonical location. If that file is a symlink to an external settings document, hook discovery reads external commands and transforming hooks copies those external handlers into the target agent's generated project hooks.

## Reproduction

From the repository root, create a disposable project whose Claude project settings file is a symlink to an external hook document, then read and bridge project hooks:

```sh
repo=$PWD
probe=$(mktemp -d)
cwd="$probe/project"
home="$probe/home"
outside="$probe/outside"
mkdir -p "$cwd/.claude" "$home" "$outside"

cat > "$outside/settings.json" <<'EOF'
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"external-secret-command"}]}]}}
EOF
ln -s "$outside/settings.json" "$cwd/.claude/settings.json"
git -C "$cwd" init -q

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { readClaudeHooks, bridgeHooks } from "file://$PWD/packages/agent-hook-config/src/index.ts";

console.log("read=" + JSON.stringify(readClaudeHooks("$cwd", "$home", { scope: "project" })));
const manifest = bridgeHooks("claude-code", "codex", "$cwd", "$home", "run-1", {
  scope: "project"
});
console.log("target=" + manifest.writtenPath);
console.log("generated=" + await readFile("$cwd/.codex/hooks.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-hook-config/src/read-hooks.ts | sed -n '32,85p'
nl -ba packages/agent-hook-config/src/bridge-hooks.ts | sed -n '202,223p'
```

## Observed Behavior

Although only `scope: "project"` is requested, the hook reader follows `.claude/settings.json -> outside/settings.json` and the transformer emits the external command into project-local Codex hooks:

```text
read={"entries":[{"event":"PreToolUse","matcher":"Bash","handler":{"type":"command","command":"external-secret-command"}}],"readPaths":[".../project/.claude/settings.json"]}
generated={
  "hooks": {
    "PreToolUse": [..."command": "external-secret-command"...]
  }
}
```

The result reports the textual in-project path as the read source even though the parsed content originates from an external symlink target.

## Expected Behavior

Project-scoped hook imports should read only configuration that canonically resides within the selected project's hook configuration location. A symlinked project source file resolving outside the project should be rejected or clearly excluded from project-scoped bridging.

## Impact

A crafted project symlink can cause normal hook bridging to ingest and install external hook commands as generated hooks for another agent. This can unexpectedly propagate outside configuration into spawned-agent execution behavior and obscures the true origin of the imported handlers.
