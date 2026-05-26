# Hook bridging follows a symlinked agent-local directory outside the project

## Summary

`bridgeHooks()` resolves the target agent's project-local hook file textually beneath the working directory but does not enforce canonical containment. If the target agent configuration directory is a symlink to an external directory, transforming project hooks writes the generated hook file into that external target, and `cleanupBridgedHooks()` later deletes the external generated file.

## Reproduction

From the repository root, create a disposable project with one Claude project hook and a symlinked Codex configuration directory, then bridge and clean up the transformed hooks:

```sh
repo=$PWD
probe=$(mktemp -d)
cwd="$probe/project"
home="$probe/home"
outside="$probe/outside"
mkdir -p "$cwd/.claude" "$home" "$outside"

cat > "$cwd/.claude/settings.json" <<'EOF'
{"hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"npm test"}]}]}}
EOF
ln -s "$outside" "$cwd/.codex"
git -C "$cwd" init -q

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { bridgeHooks, cleanupBridgedHooks } from "file://$PWD/packages/agent-hook-config/src/index.ts";

const manifest = bridgeHooks("claude-code", "codex", "$cwd", "$home", "run-1", {
  scope: "project"
});
console.log("path=" + manifest.writtenPath);
console.log("external=" + await readFile("$outside/hooks.json", "utf8"));
cleanupBridgedHooks(manifest);
console.log("existsAfterCleanup=" + String(await stat("$outside/hooks.json").then(() => true, () => false)));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"

nl -ba packages/agent-hook-config/src/configs.ts | sed -n '130,168p'
nl -ba packages/agent-hook-config/src/bridge-hooks.ts | sed -n '140,310p'
nl -ba packages/agent-hook-config/src/write-hooks.ts | sed -n '73,104p'
```

## Observed Behavior

The bridge reports an in-project Codex hooks path while filesystem resolution of `.codex -> outside` redirects its generated output and cleanup externally:

```text
path=.../project/.codex/hooks.json
external={
  "hooks": {
    "PreToolUse": [..."statusMessage": "[generated:run-1] "...]
  }
}
existsAfterCleanup=false
```

The operation uses ordinary supported agent identifiers and project-scoped hooks. No traversal string is needed; the existing target-parent symlink is followed by the target writer and cleanup routine.

## Expected Behavior

Generated bridged hook state should be constrained beneath the canonical project-local hook configuration location for the target agent. A target parent that resolves outside the project should be rejected before writing or deleting any file.

## Impact

A crafted project symlink can redirect spawned-agent hook setup into arbitrary writable external directories and cause teardown to delete the resulting external generated hook file. This violates the temporary project-local hook bridge boundary during normal agent configuration bridging.
