# Task list build symlinked dist directory writes outside package

## Summary

The `@poe-code/task-list` package build compiles its Markdown, YAML, and GitHub task backends into `dist` without checking a symlinked output directory. A normal build can therefore write the backend artifact tree outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-task-list-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/task-list" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/task-list/src "$probe/packages/task-list/"
cp packages/task-list/package.json packages/task-list/tsconfig.json "$probe/packages/task-list/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/task-list/dist"
(cd "$probe/packages/task-list" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/task-list/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/markdown-dir.js"
rm -rf "$probe"
```

The build succeeds with output outside the package:

```text
target=/private/tmp/poe-task-list-npm-build-probe.IN90a6/outside files=gh-issues-client.d.ts,gh-issues-client.js,gh-issues-sync.d.ts,gh-issues-sync.js,gh-issues.d.ts,gh-issues.js,index.d.ts,index.js,markdown-dir.d.ts,markdown-dir.js,open.d.ts,open.js
```

## Observed Behavior

`packages/task-list/package.json` uses `tsc` for builds, and its compiler output root is `dist`. It performs no containment check before following an externally targeted `dist` symlink.

## Expected Behavior

Task-list builds should write generated backend modules only beneath canonical `packages/task-list/dist` and reject escaped output roots.

## Impact

A manipulated checkout can redirect a routine task-list build into external overwrites under local or CI privileges while the compile reports success.
