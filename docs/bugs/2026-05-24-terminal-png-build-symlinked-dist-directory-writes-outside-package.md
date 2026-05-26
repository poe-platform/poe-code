# Terminal PNG build symlinked dist directory writes outside package

## Summary

The `terminal-png` package build compiles its ANSI parser and image-rendering modules into `dist` through `tsc -p tsconfig.build.json` without output-root containment validation. A symlinked output directory redirects the successful build outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-terminal-png-alt-build-probe.XXXXXX)
mkdir -p "$probe/packages/terminal-png" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/terminal-png/src packages/terminal-png/assets "$probe/packages/terminal-png/"
cp packages/terminal-png/package.json packages/terminal-png/tsconfig*.json "$probe/packages/terminal-png/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/terminal-png/dist"
(cd "$probe/packages/terminal-png" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/terminal-png/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/png-renderer.js"
rm -rf "$probe"
```

The successful reproduction prints:

```text
target=/private/tmp/poe-terminal-png-alt-build-probe.9huk0B/outside files=ansi-parser.d.ts,ansi-parser.js,cli.d.ts,cli.js,font.d.ts,font.js,index.d.ts,index.js,png-renderer.d.ts,png-renderer.js,svg-renderer.d.ts,svg-renderer.js
```

## Observed Behavior

`packages/terminal-png/package.json` invokes `tsc -p tsconfig.build.json`; `packages/terminal-png/tsconfig.build.json:4` emits to `dist`. No build step validates that `dist` is not an external symlink before generated renderer modules are written through it.

## Expected Behavior

The terminal image renderer build should emit code only beneath canonical `packages/terminal-png/dist`, rejecting output symlink escapes before writes.

## Impact

A normal package build can overwrite external files with generated image-renderer code in an untrusted checkout while returning success.
