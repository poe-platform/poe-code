# Experiment loop build symlinked dist directory writes outside package

## Summary

The `@poe-code/experiment-loop` build emits experiment modules and copies default instruction assets into `dist` without rejecting external output-directory symlinks. A routine build writes both classes of artifacts outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-experiment-loop-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/experiment-loop" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/experiment-loop/src packages/experiment-loop/scripts packages/experiment-loop/assets "$probe/packages/experiment-loop/"
cp packages/experiment-loop/package.json packages/experiment-loop/tsconfig.json "$probe/packages/experiment-loop/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/experiment-loop/dist"
(cd "$probe/packages/experiment-loop" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/experiment-loop/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/default-instructions.md"
rm -rf "$probe"
```

The successful reproduction prints:

```text
target=/private/tmp/poe-experiment-loop-npm-build-probe.3OaDIc/outside files=default-instructions.md,default-run.yaml,discovery.d.ts,discovery.js,evaluator.d.ts,evaluator.js,frontmatter.d.ts,frontmatter.js,git.d.ts,git.js,index.d.ts,index.d.ts,index.js,index.js
```

## Observed Behavior

The package build combines TypeScript emission and asset copying into its `dist` tree, following an externally redirected output root without containment checks.

## Expected Behavior

Experiment-loop build outputs and default assets should remain beneath canonical `packages/experiment-loop/dist`, refusing escaped symlinks.

## Impact

Routine experiment package builds can overwrite external generated-code and configuration files while appearing successful.
