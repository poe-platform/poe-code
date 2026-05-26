# Superintendent build symlinked dist directory writes outside package

## Summary

The `@poe-code/superintendent` build emits compiled command modules and copies the superintendent skill template into `dist` without preventing external symlink redirection. A routine build writes generated code and Markdown content outside the package tree.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-superintendent-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/superintendent" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/superintendent/src packages/superintendent/scripts packages/superintendent/templates "$probe/packages/superintendent/"
cp packages/superintendent/package.json packages/superintendent/tsconfig.json "$probe/packages/superintendent/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/superintendent/dist"
(cd "$probe/packages/superintendent" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/superintendent/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/cli.js" && test -f "$probe/outside/SKILL_superintendent.md"
rm -rf "$probe"
```

The successful build begins its external outputs with:

```text
target=/private/tmp/poe-superintendent-npm-build-probe.4QqYq8/outside files=SKILL_superintendent.md,agent-runner.d.ts,agent-runner.js,agentic-tools.d.ts,agentic-tools.js,builder-group.d.ts,builder-group.js,cli.d.ts,cli.js,complete.d.ts,complete.js,config-scope.d.ts,config-scope.js,direct-execution.d.ts
```

## Observed Behavior

The package's `tsc` and template-copy build steps write into `dist` without checking whether the output root canonically remains within `superintendent` before following a symlink externally.

## Expected Behavior

Superintendent build modules and skill templates should only be written beneath canonical `packages/superintendent/dist`, rejecting escaped output roots.

## Impact

A normal build can overwrite unrelated external executable or Markdown files in an untrusted workspace while returning success.
