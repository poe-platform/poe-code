# Terminal Pilot MCP build follows a symlinked dist directory and writes outside the package

## Summary

The `@poe-code/terminal-pilot-mcp` package build hands its fixed `dist` output directory directly to `esbuild` without rejecting symbolic links. A symlinked `dist` directory redirects generated JavaScript bundles and source maps outside the package.

## Reproduction

1. From the repository root, run this disposable clean-copy probe. Existing generated package artifacts are copied only to satisfy internal source imports during bundling:

   ```sh
   probe=$(mktemp -d /tmp/poe-terminal-pilot-mcp-build-probe.XXXXXX)
   git archive --format=tar HEAD | tar -xf - -C "$probe"
   ln -s "$PWD/node_modules" "$probe/node_modules"
   for src in packages/*/dist; do
     [ -d "$src" ] || continue
     pkg=${src%/dist}; pkg=${pkg#packages/}
     mkdir -p "$probe/packages/$pkg"
     cp -R "$src" "$probe/packages/$pkg/"
   done
   mkdir -p "$probe/outside"
   rm -rf "$probe/packages/terminal-pilot-mcp/dist"
   ln -s "$probe/outside" "$probe/packages/terminal-pilot-mcp/dist"

   (cd "$probe" && node packages/terminal-pilot-mcp/scripts/build.mjs)

   realpath "$probe/packages/terminal-pilot-mcp/dist"
   find "$probe/outside" -maxdepth 1 -type f -print | sort
   ```

## Observed Behavior

The apparent package `dist` directory resolves externally, and the build writes generated `cli.js`, `cli.js.map`, `index.js`, and `index.js.map` files into the external target.

`packages/terminal-pilot-mcp/scripts/build.mjs:9` defines the output directory, and `packages/terminal-pilot-mcp/scripts/build.mjs:84` through `packages/terminal-pilot-mcp/scripts/build.mjs:96` direct `esbuild` output into it without checking that it remains within the package tree. `packages/terminal-pilot-mcp/scripts/build.mjs:98` through `packages/terminal-pilot-mcp/scripts/build.mjs:102` subsequently read and may rewrite the external generated CLI file as well.

## Expected Behavior

Package bundling should emit files only beneath the canonical package `dist` directory. A symbolic-link output directory resolving externally should be rejected before generated files are written.

## Impact

A crafted checkout or stale `dist` symlink can cause a normal `@poe-code/terminal-pilot-mcp` build to create or overwrite several external JavaScript artifacts with developer or CI privileges.
