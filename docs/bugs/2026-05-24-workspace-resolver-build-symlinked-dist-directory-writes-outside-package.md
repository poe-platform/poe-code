# Workspace resolver build symlinked dist directory writes outside package

## Summary

The `@poe-code/workspace-resolver` build emits clone and isolation modules into a fixed `dist` output path without symlink containment validation. A linked `dist` output directory redirects generated artifacts outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-workspace-resolver-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/workspace-resolver" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/workspace-resolver/src "$probe/packages/workspace-resolver/"
cp packages/workspace-resolver/package.json packages/workspace-resolver/tsconfig.json "$probe/packages/workspace-resolver/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/workspace-resolver/dist"
(cd "$probe/packages/workspace-resolver" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/workspace-resolver/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/resolve.js"
rm -rf "$probe"
```

The normal build succeeds with external artifacts:

```text
target=/private/tmp/poe-workspace-resolver-npm-build-probe.IHiYgm/outside files=clone.d.ts,clone.js,index.d.ts,index.js,isolation.d.ts,isolation.js,parse.d.ts,parse.js,resolve.d.ts,resolve.js
```

## Observed Behavior

`packages/workspace-resolver/package.json:15` invokes `tsc`, and `packages/workspace-resolver/tsconfig.json:4` emits into `dist`. Compilation performs no output-root containment validation before writing through a symlink.

## Expected Behavior

The workspace-resolver build should refuse an output destination outside its canonical package `dist` path before writing any artifacts.

## Impact

Builds launched in compromised or misconfigured workspaces can overwrite external files with generated workspace-isolation modules and declarations while returning success.
