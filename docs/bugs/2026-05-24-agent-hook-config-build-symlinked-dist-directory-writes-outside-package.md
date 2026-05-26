# Agent hook config build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-hook-config` build emits hook-bridge implementation files directly beneath `dist` and does not validate symlink redirection. Linking `dist` outside the package redirects the normal build's generated files externally.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-agent-hook-config-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-hook-config" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-hook-config/src "$probe/packages/agent-hook-config/"
cp packages/agent-hook-config/package.json packages/agent-hook-config/tsconfig.json "$probe/packages/agent-hook-config/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-hook-config/dist"
(cd "$probe/packages/agent-hook-config" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-hook-config/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/bridge-hooks.js"
rm -rf "$probe"
```

The successful build writes externally:

```text
target=/private/tmp/poe-agent-hook-config-npm-build-probe.W1quEt/outside files=bridge-hooks.d.ts,bridge-hooks.js,configs.d.ts,configs.js,event-mapping.d.ts,event-mapping.js,exports.compile-check.d.ts,exports.compile-check.js,index.d.ts,index.js
```

## Observed Behavior

`packages/agent-hook-config/package.json:15` invokes `tsc`, and `packages/agent-hook-config/tsconfig.json:4` targets `dist`. There is no canonical output-root check before TypeScript follows a symlink and writes the generated hook modules outside the package.

## Expected Behavior

The package build should emit only within its canonical `dist` directory and refuse symlinked output directories that escape it.

## Impact

An attacker-controlled checkout can redirect a standard hook-config build into unintended external file writes under developer or CI privileges.
