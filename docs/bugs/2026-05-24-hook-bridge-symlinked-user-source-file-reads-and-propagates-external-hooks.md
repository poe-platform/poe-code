# Hook bridging follows a symlinked user source file and propagates external hooks

## Summary

`readClaudeHooks()` and `bridgeHooks()` treat `<home>/.claude/settings.json` as user-scoped hook input without verifying its canonical location. If that file is a symbolic link to an external settings document, user-scope hook discovery reads external commands and transforming hooks copies those external handlers into generated project Codex hooks.

## Reproduction

From the repository root, create a disposable home whose Claude user settings file links externally, then read and bridge user-scoped hooks:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.codex" "$probe/home/.claude" "$probe/outside"
cat > "$probe/outside/settings.json" <<'EOF'
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"external-global-command"}]}]}}
EOF
ln -s "$probe/outside/settings.json" "$probe/home/.claude/settings.json"

cat > "$probe/repro.mts" <<EOF
import { readFile } from "node:fs/promises";
import { readClaudeHooks, bridgeHooks } from "file://$PWD/packages/agent-hook-config/src/index.ts";

console.log("read=" + JSON.stringify(readClaudeHooks("$probe/project", "$probe/home", { scope: "user" })));
const manifest = bridgeHooks("claude-code", "codex", "$probe/project", "$probe/home", "run-user", { scope: "user" });
console.log("target=" + manifest.writtenPath);
console.log("generated=" + await readFile("$probe/project/.codex/hooks.json", "utf8"));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/home/.claude/settings.json"

nl -ba packages/agent-hook-config/src/configs.ts | sed -n '49,94p;130,167p'
nl -ba packages/agent-hook-config/src/read-hooks.ts | sed -n '32,85p'
nl -ba packages/agent-hook-config/src/bridge-hooks.ts | sed -n '158,225p'
```

## Observed Behavior

Although only `scope: "user"` is requested, the hook reader follows the user settings symlink outside the home directory and the bridge emits the external command into project-local Codex hooks:

```text
<probe>/home/.claude/settings.json -> <probe>/outside/settings.json
read={"entries":[{"event":"PreToolUse","matcher":"Bash","handler":{"type":"command","command":"external-global-command"}}],...}
target=<probe>/project/.codex/hooks.json
generated=..."command": "external-global-command"...
```

`resolveHookPath()` produces a textual user-state path, and `readClaudeHooks()` reads it directly. `bridgeHooks()` then transforms the externally sourced handler without validating canonical home-state containment.

## Expected Behavior

User-scoped hook discovery and bridging should load hook definitions only from canonical files inside the selected user's hook configuration directory. A symlinked user settings file escaping that directory should be rejected rather than propagated.

## Impact

External hook commands can be imported as trusted user-level Claude hooks and written into generated Codex project hooks. This can inject execution behavior through a user-scope configuration surface while obscuring that the original hook content came from outside expected user state.
