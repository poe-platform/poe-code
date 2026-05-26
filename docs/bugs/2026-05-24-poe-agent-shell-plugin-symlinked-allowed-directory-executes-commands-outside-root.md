# Poe Agent shell plugin follows a symlinked allowed directory and executes commands outside its root

## Summary

The Poe Agent `shellPlugin()` validates an optional command working directory lexically beneath `cwd` or configured `allowedPaths`, but does not verify canonical filesystem containment. If an allowed descendant directory is a symbolic link to an external location, `run_command` executes there and permits shell side effects outside the authorized root.

## Reproduction

From the repository root, create an allowed project directory containing a symlink to an external directory and invoke the plugin's exported `run_command` tool with that working directory:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/outside"
ln -s "$probe/outside" "$probe/project/linked"

cat > "$probe/repro.mts" <<EOF
import shellPlugin from "file://$PWD/packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts";

const plugin = shellPlugin({ cwd: "$probe/project" });
const run = plugin.tools.find((tool: any) => tool.name === "run_command") as any;
const controller = new AbortController();

console.log(
  await run.call(
    { command: "pwd > marker.txt", cwd: "linked" },
    { signal: controller.signal }
  )
);
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/project/linked"
cat "$probe/outside/marker.txt"

nl -ba packages/poe-agent/src/plugins/plugin-args.ts | sed -n '94,110p'
nl -ba packages/poe-agent/src/plugins/poe-agent-plugin-shell.ts | sed -n '82,149p;766,786p'
```

## Observed Behavior

The tool accepts `linked` as an allowed project-relative working directory but launches the command in the external symlink target:

```text
Command completed with no output
<probe>/project/linked -> <probe>/outside
<probe>/outside/marker.txt contains: <probe>/outside
```

`resolveAllowedPath()` checks only lexical path ancestry, and `spawnShellCommand()` passes the resulting symlinked directory directly as the child process `cwd` without canonical validation.

## Expected Behavior

Poe Agent shell commands should execute only inside canonical working directories beneath their configured allowed roots. A symlinked descendant escaping an allowed directory should be rejected before command execution.

## Impact

An agent granted command execution within a project can perform arbitrary shell side effects outside that authorized tree whenever the project contains a suitable symlink. Tool callers may believe execution was sandboxed to a project-relative directory while writes and subprocess behavior occur externally.
