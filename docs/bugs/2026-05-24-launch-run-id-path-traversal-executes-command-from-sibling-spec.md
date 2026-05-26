# Launch run process id path traversal executes command from sibling spec

## Summary

The hidden `poe-code launch __run <id>` command accepts path traversal segments in the managed process id. Supplying `../victim` causes it to read and execute a crafted process specification from `.poe-code/victim/spec.json`, outside the intended `.poe-code/launch` directory.

## Environment

- Date reproduced: 2026-05-24
- Repository branch: `main`
- Package version: `0.0.0-dev`
- Runtime: source CLI entrypoint with a disposable `HOME`, disposable working directory, and `/usr/bin/touch` as a harmless proof-of-execution command

## Reproduction

From the repository root, create a process specification in a sibling directory of launch state, then invoke the hidden daemon path with a traversal id:

```sh
repo=$PWD
probe=$(mktemp -d)
home="$probe/home"
project="$probe/project"
mkdir -p "$home/.poe-code/victim" "$project"
cat > "$home/.poe-code/victim/spec.json" <<EOF_SPEC
{
  "id": "../victim",
  "command": "/usr/bin/touch",
  "args": ["$probe/executed-marker"],
  "restart": "never"
}
EOF_SPEC

(
  cd "$project" &&
  HOME="$home" \
    "$repo/node_modules/.bin/tsx" \
    --import "$repo/scripts/register-template-loader.mjs" \
    "$repo/src/index.ts" launch __run ../victim
)

test -e "$probe/executed-marker" && echo executed=yes || echo executed=no
find "$home/.poe-code/victim" -maxdepth 2 -type f -print | sort
```

## Observed Behavior

The hidden launch runner exits successfully after executing the command loaded from the sibling directory:

```text
executed=yes
.../home/.poe-code/victim/meta.json
.../home/.poe-code/victim/spec.json
.../home/.poe-code/victim/state.json
```

The proof marker is created only because the command in `.poe-code/victim/spec.json` was launched.

## Expected Behavior

`launch __run` should reject process ids containing path separators or traversal segments, or otherwise constrain all specification lookup and execution beneath `.poe-code/launch`. It must not execute a specification stored in a sibling path such as `.poe-code/victim`.

## Impact

- Any caller able to invoke the CLI can execute commands described by crafted JSON files outside the managed launch state root by choosing a traversing process id.
- This converts the unchecked launch identifier from a storage isolation defect into an execution boundary bypass.
- The same identifier family already enables outside-root state creation, log disclosure, and deletion, increasing the severity of the shared validation failure.

## Supporting Evidence

In `src/cli/commands/launch.ts`, the hidden `__run` command forwards its user-controlled `<id>` directly to `runLaunchDaemon()`. `src/sdk/launch.ts` forwards the id into `runManagedProcess()`. In `packages/process-launcher/src/launcher.ts`, `readSpec(fs, baseDir, id)` resolves `path.join(baseDir, id, "spec.json")` without validating the identifier or checking path containment; the loaded `spec.command` is then passed into the supervisor, which executes it through the process runner.

## Suspected Area

Launch process identifiers must be validated at every public and internal entrypoint, and daemon execution should only load specs resolved inside the configured launch state root after containment validation.
