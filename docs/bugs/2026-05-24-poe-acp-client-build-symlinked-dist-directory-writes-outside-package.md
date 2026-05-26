# Poe ACP client build symlinked dist directory writes outside package

## Summary

The `@poe-code/poe-acp-client` build compiles transport and message-layer modules into `dist` without detecting symlinked output redirection. A normal build can emit generated ACP client artifacts outside the package directory.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-poe-acp-client-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/poe-acp-client" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/poe-acp-client/src "$probe/packages/poe-acp-client/"
cp packages/poe-acp-client/package.json packages/poe-acp-client/tsconfig.json "$probe/packages/poe-acp-client/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/poe-acp-client/dist"
(cd "$probe/packages/poe-acp-client" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/poe-acp-client/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -12 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/acp-client.js"
rm -rf "$probe"
```

The build exits successfully with:

```text
target=/private/tmp/poe-poe-acp-client-npm-build-probe.qKg73K/outside files=acp-client.d.ts,acp-client.js,acp-transport.d.ts,acp-transport.js,index.d.ts,index.js,jsonrpc-message-layer.d.ts,jsonrpc-message-layer.js,jsonrpc.d.ts,jsonrpc.js,run-report.d.ts,run-report.js
```

## Observed Behavior

The package's `tsc` build emits into `dist` as configured in `packages/poe-acp-client/tsconfig.json:4`; it does not reject an output path that resolves externally through a symlink.

## Expected Behavior

Generated ACP client files should stay inside canonical `packages/poe-acp-client/dist`, failing before output on escaped symlinks.

## Impact

A regular ACP-client build can overwrite external content under developer or CI privileges when the package output directory has been redirected.
