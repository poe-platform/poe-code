# Config mutations build symlinked dist directory writes outside package

## Summary

The `@poe-code/config-mutations` build emits mutation helpers beneath `dist` without checking whether the output directory escapes through a symbolic link. A standard package build writes generated modules into an external symlink target.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-config-mutations-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/config-mutations" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/config-mutations/src "$probe/packages/config-mutations/"
cp packages/config-mutations/package.json packages/config-mutations/tsconfig.json "$probe/packages/config-mutations/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/config-mutations/dist"
(cd "$probe/packages/config-mutations" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/config-mutations/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/file-mutation.js"
rm -rf "$probe"
```

The successful reproduction prints:

```text
target=/private/tmp/poe-config-mutations-npm-build-probe.2s4TE2/outside files=apply-mutation.d.ts,apply-mutation.js,config-mutation.d.ts,config-mutation.js,file-mutation.d.ts,file-mutation.js,format-utils.d.ts,format-utils.js,fs-utils.d.ts,fs-utils.js,index.d.ts,index.d.ts
```

## Observed Behavior

`packages/config-mutations/package.json` invokes `tsc`, and its TypeScript configuration emits to `dist`. The build follows a linked output directory without validating canonical package containment before writing generated files externally.

## Expected Behavior

Generated mutation modules should be written only under canonical `packages/config-mutations/dist`, with symlink escapes rejected before emission.

## Impact

Routine configuration-library builds in a crafted workspace can overwrite external files while returning success.
