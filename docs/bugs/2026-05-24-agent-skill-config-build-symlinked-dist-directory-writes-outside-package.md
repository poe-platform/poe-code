# Agent skill config build symlinked dist directory writes outside package

## Summary

The `@poe-code/agent-skill-config` build emits compiled bridge modules and copies skill template Markdown beneath `dist` without verifying output-root containment. A symlinked `dist` sends both generated code and skill assets outside the package.

## Reproduction

```sh
probe=$(mktemp -d /tmp/poe-agent-skill-config-npm-build-probe.XXXXXX)
mkdir -p "$probe/packages/agent-skill-config" "$probe/outside"
cp tsconfig.json "$probe/"
cp -R packages/agent-skill-config/src packages/agent-skill-config/scripts packages/agent-skill-config/templates "$probe/packages/agent-skill-config/"
cp packages/agent-skill-config/package.json packages/agent-skill-config/tsconfig.json "$probe/packages/agent-skill-config/"
ln -s "$PWD/node_modules" "$probe/node_modules"
ln -s "$probe/outside" "$probe/packages/agent-skill-config/dist"
(cd "$probe/packages/agent-skill-config" && npm run build --silent)
printf 'target=%s files=' "$(realpath "$probe/packages/agent-skill-config/dist")"
find "$probe/outside" -type f -exec basename {} \; | sort | head -14 | paste -sd, -
test -f "$probe/outside/index.js" && test -f "$probe/outside/poe-generate.md"
rm -rf "$probe"
```

The successful output includes:

```text
target=/private/tmp/poe-agent-skill-config-npm-build-probe.4zxFBB/outside files=apply.d.ts,apply.js,bridge-active-skills.d.ts,bridge-active-skills.js,configs.d.ts,configs.js,exports.compile-check.d.ts,exports.compile-check.js,git-exclude.d.ts,git-exclude.js,index.d.ts,index.js,poe-generate.md,resolve-skill-reference.d.ts
```

## Observed Behavior

The package's TypeScript build and subsequent template-copy step write through a symlinked `dist` output root without rejecting its external canonical target.

## Expected Behavior

Agent-skill configuration builds should emit modules and templates only beneath canonical `packages/agent-skill-config/dist`.

## Impact

Normal skill-configuration builds can overwrite external files with generated code and Markdown assets in a crafted checkout.
