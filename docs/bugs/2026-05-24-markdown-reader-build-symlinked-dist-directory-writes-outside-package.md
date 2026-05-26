# Markdown reader build symlinked dist directory writes outside package

## Summary

The `@poe-code/markdown-reader` build compiles its exported reader and MCP modules beneath a fixed `dist` output root. It does not reject a symbolic link at that root, allowing a standard `npm run build` to write all generated artifacts outside the package directory.

## Reproduction

From the repository root, run a disposable redirected-output build:

```sh
probe=$(mktemp -d /tmp/poe-markdown-reader-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/markdown-reader" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/markdown-reader/src "$probe/packages/markdown-reader/"
cp packages/markdown-reader/package.json packages/markdown-reader/tsconfig.json "$probe/packages/markdown-reader/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/markdown-reader/dist"

(cd "$probe/packages/markdown-reader" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/markdown-reader/dist")"
printf 'files='
find "$probe/outside" -type f -exec basename {} \; | sort | head -8 | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/read-markdown.js"
test -f "$probe/outside/group.js"
rm -rf "$probe"
```

The reproduction exits successfully and prints externally generated modules:

```text
dist_target=/private/tmp/poe-markdown-reader-npm-build-probe.TmZ3T1/outside
files=document.d.ts,document.js,group.d.ts,group.js,index.d.ts,index.js,read-markdown.d.ts,read-markdown.js
```

## Observed Behavior

`packages/markdown-reader/package.json` defines the build command as `tsc`, and its TypeScript configuration directs output into `dist`. The compiler follows a pre-existing output-directory symlink without the package verifying that generated artifacts remain within its intended output tree.

## Expected Behavior

`@poe-code/markdown-reader` should emit build files only beneath its canonical package output directory, and fail before writing when `dist` resolves outside the package.

## Impact

An untrusted checkout or leftover symlink can redirect a routine Markdown reader build to overwrite external content with generated code and declarations under the privileges of local development or CI.
