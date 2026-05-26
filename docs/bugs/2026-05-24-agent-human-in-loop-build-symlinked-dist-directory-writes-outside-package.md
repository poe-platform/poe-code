# Agent human in loop build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-human-in-loop` build writes compiled approval and `osascript` modules into a fixed `dist` output directory without symlink containment checks. A symlink at `dist` redirects successful build writes outside the package.

## Reproduction

From the repository root, run:

```sh
probe=$(mktemp -d /tmp/poe-agent-human-in-loop-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-human-in-loop" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-human-in-loop/src "$probe/packages/agent-human-in-loop/"
cp packages/agent-human-in-loop/package.json packages/agent-human-in-loop/tsconfig.json "$probe/packages/agent-human-in-loop/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-human-in-loop/dist"
(cd "$probe/packages/agent-human-in-loop" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-human-in-loop/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -10 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/osascript.js"
rm -rf "$probe"
```

The build succeeds and prints:

```text
target=/private/tmp/poe-agent-human-in-loop-npm-build-probe.alQnu5/outside files=index.d.ts,index.js,mock.d.ts,mock.js,osascript-script.d.ts,osascript-script.js,osascript.d.ts,osascript.js,request-approval.d.ts,request-approval.js
```

## Observed Behavior

`packages/agent-human-in-loop/package.json:15` runs `tsc`, with `packages/agent-human-in-loop/tsconfig.json:4` setting `outDir` to `dist`. The emitter writes through a linked output root into an unrelated external directory.

## Expected Behavior

The build should reject an output-directory symlink that resolves outside `packages/agent-human-in-loop/dist` before emitting artifacts.

## Impact

Routine builds in a manipulated workspace can overwrite external files with approval-related compiled code and declarations while appearing successful.
