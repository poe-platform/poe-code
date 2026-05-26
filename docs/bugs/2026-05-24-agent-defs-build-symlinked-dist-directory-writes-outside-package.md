# Agent definitions build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-defs` build emits the agent registry and generated type declarations into `dist` without checking whether that path is a symlink. Redirecting the output directory causes the standard build to create agent-definition artifacts outside the package tree.

## Reproduction

From the repository root, create a disposable linked-output package and run its configured build:

```sh
probe=$(mktemp -d /tmp/poe-agent-defs-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-defs" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-defs/src "$probe/packages/agent-defs/"
cp packages/agent-defs/package.json packages/agent-defs/tsconfig.json "$probe/packages/agent-defs/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-defs/dist"

(cd "$probe/packages/agent-defs" && npm run build --silent)
printf 'dist_target=%s\n' "$(realpath "$probe/packages/agent-defs/dist")"
printf 'files='
find "$probe/outside" -type f -exec basename {} \; | sort | head -8 | paste -sd, -

test -f "$probe/outside/index.js"
test -f "$probe/outside/codex.js"
test -f "$probe/outside/registry.js"
rm -rf "$probe"
```

The reproduction completes successfully and writes generated definitions outside the package:

```text
dist_target=/private/tmp/poe-agent-defs-npm-build-probe.xkjfaP/outside
files=claude-code.d.ts,claude-code.js,claude-desktop.d.ts,claude-desktop.js,codex.d.ts,codex.js,gemini-cli.d.ts,gemini-cli.js
```

## Observed Behavior

`packages/agent-defs/package.json` uses `tsc` for builds, and its TypeScript output configuration emits beneath `dist`. A pre-existing symlink at that output root is followed without validation, causing emitted agent modules and declarations to be written to the external link target.

## Expected Behavior

The package build should only emit generated agent-definition artifacts under the canonical package `dist` directory, refusing an output-directory symlink that escapes that location.

## Impact

A malicious or accidental output symlink can redirect standard package builds to overwrite unrelated files outside `agent-defs` while appearing to complete normally in development or CI.
