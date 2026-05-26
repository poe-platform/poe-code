# Agent spawn build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-spawn` package build emits provider and autonomous-spawn modules beneath `dist` without checking for symlink escape. A linked output directory redirects a standard successful build outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-spawn-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-spawn" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-spawn/src "$probe/packages/agent-spawn/"
cp packages/agent-spawn/package.json packages/agent-spawn/tsconfig.json "$probe/packages/agent-spawn/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-spawn/dist"
(cd "$probe/packages/agent-spawn" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-spawn/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/autonomous.js" && test -f "$probe/outside/codex.js"
rm -rf "$probe"
```

The build succeeds and prints:

```text
target=/private/tmp/poe-agent-spawn-npm-build-probe.NXzrJe/outside files=autonomous.d.ts,autonomous.js,claude-code.d.ts,claude-code.js,claude-desktop.d.ts,claude-desktop.js,claude.d.ts,claude.js,codex.d.ts,codex.d.ts,codex.js,codex.js
```

## Observed Behavior

`packages/agent-spawn/package.json` builds via `tsc`, with `packages/agent-spawn/tsconfig.json:4` emitting into `dist`; no canonical containment guard prevents writes through a symlinked output root.

## Expected Behavior

The package build should emit only inside canonical `packages/agent-spawn/dist` and refuse escaped output destinations.

## Impact

Standard agent-spawn builds can overwrite arbitrary external files from a crafted worktree while appearing successful.
