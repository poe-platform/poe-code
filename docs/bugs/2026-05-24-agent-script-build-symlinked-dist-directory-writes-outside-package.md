# Agent script build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-script` build emits compiled agent-script checks and runtime modules under `dist` without guarding against symlinked output roots. A linked `dist` causes regular builds to write a broad artifact set outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-agent-script-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-script" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-script/src "$probe/packages/agent-script/"
cp packages/agent-script/package.json packages/agent-script/tsconfig.json "$probe/packages/agent-script/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-script/dist"
(cd "$probe/packages/agent-script" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-script/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" || test -f "$probe/outside/AS-async-not-needed.js"
rm -rf "$probe"
```

The package build succeeds and begins its external artifact set with:

```text
target=/private/tmp/poe-agent-script-npm-build-probe.NNvUdi/outside files=AS-async-not-needed.d.ts,AS-async-not-needed.js,AS-await-non-promise.d.ts,AS-await-non-promise.js,AS-destructure-null-default.d.ts,AS-destructure-null-default.js,AS-export-import-meta.d.ts,AS-export-import-meta.js,AS-floating-promise.d.ts,AS-floating-promise.js,AS-frontmatter-field-unused.d.ts,AS-frontmatter-field-unused.js
```

## Observed Behavior

`packages/agent-script/package.json` invokes TypeScript compilation into `dist`, and the output root is followed if it is a symlink to an external directory. No build guard prevents these emitted files from escaping the package tree.

## Expected Behavior

Agent-script build outputs should be contained within canonical `packages/agent-script/dist`, rejecting output roots that resolve elsewhere.

## Impact

The sizeable compiled agent-script output set can be redirected to overwrite external files during a seemingly normal local or automated build.
