# Process runner build symlinked dist directory writes outside package

## Summary

The `@poe-code/process-runner` build emits host and Docker execution modules into `dist` without verifying the resolved output root. A symlinked directory redirects successful package-build output outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-process-runner-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/process-runner" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/process-runner/src "$probe/packages/process-runner/"
cp packages/process-runner/package.json packages/process-runner/tsconfig.json "$probe/packages/process-runner/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/process-runner/dist"
(cd "$probe/packages/process-runner" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/process-runner/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/docker-execution-env.js" && test -f "$probe/outside/host-runner.js"
rm -rf "$probe"
```

The reproduction completes successfully:

```text
target=/private/tmp/poe-process-runner-npm-build-probe.qHKN1N/outside files=args.d.ts,args.js,context.d.ts,context.js,docker-execution-env.d.ts,docker-execution-env.js,docker-runner.d.ts,docker-runner.js,engine.d.ts,engine.js,host-execution-env.d.ts,host-execution-env.js,host-runner.d.ts,host-runner.js
```

## Observed Behavior

`packages/process-runner/package.json` runs `tsc` to a `dist` output directory that can be an external symlink target; no pre-emission containment guard rejects it.

## Expected Behavior

Process-runner generated code should remain under canonical `packages/process-runner/dist`, refusing output links outside the package.

## Impact

A normal runner build can silently overwrite unrelated external files under developer or CI privileges while returning success.
