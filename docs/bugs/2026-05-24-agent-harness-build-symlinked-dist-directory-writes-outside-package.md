# Agent harness build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-harness` build emits compiled modules and copied harness templates beneath `dist` without rejecting a symlinked output root. The normal build can therefore write both code and template assets outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-harness-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-harness" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-harness/src packages/agent-harness/scripts packages/agent-harness/templates "$probe/packages/agent-harness/"
cp packages/agent-harness/package.json packages/agent-harness/tsconfig.json "$probe/packages/agent-harness/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-harness/dist"
(cd "$probe/packages/agent-harness" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-harness/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/coverage-demo.md"
rm -rf "$probe"
```

The reproduction emits outside the package:

```text
target=/private/tmp/poe-agent-harness-npm-build-probe.vn5BR2/outside files=coverage-demo.ajs,coverage-demo.md,discover.d.ts,discover.js,emit-schemas.d.ts,emit-schemas.js,experiment-demo.ajs,experiment-demo.md,extract-schema.d.ts,extract-schema.js,index.d.ts,index.d.ts,index.js,index.js
```

## Observed Behavior

The package build runs TypeScript emission followed by template copying into `dist`; neither stage rejects an output-directory symlink targeting an external location.

## Expected Behavior

Harness build modules and templates should be written only below canonical `packages/agent-harness/dist`, rejecting output-root escapes before writes.

## Impact

A normal build can overwrite external files with both executable harness modules and template content while reporting success.
