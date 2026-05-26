# Agent eval initialization follows a symlinked source directory and writes scaffold files outside the project

## Summary

The `@poe-code/agent-eval` initialization API creates a new eval scaffold below its supplied absolute `sourceDir` without rejecting symbolic links. A project-local eval source directory that resolves externally causes all generated eval files to be written outside the project.

## Reproduction

1. From the repository root, run this disposable project-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-eval-init-root-probe.XXXXXX)
   mkdir -p "$probe/project" "$probe/outside"
   ln -s "$probe/outside" "$probe/project/evals"
   cat > "$probe/repro.mts" <<EOF
   import { evalInit } from "${workspace}/packages/agent-eval/src/init/init.ts";
   console.log(JSON.stringify(await evalInit({
     sourceDir: "${probe}/project/evals",
     name: "probe-eval",
     kind: "plan"
   })));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/evals"
   find "$probe/outside/probe-eval" -type f -print | sort
   ```

## Observed Behavior

The returned `evalDir` appears below the project-facing `evals` source directory, but that directory resolves externally. Initialization creates external `eval.yaml`, `plan.md`, oracle fixture files, and the starter placeholder.

`packages/agent-eval/src/init/init.ts:31` through `packages/agent-eval/src/init/init.ts:63` validate only the eval name and textual absoluteness of `sourceDir`, then create and write the scaffold beneath the unchecked destination.

## Expected Behavior

Eval initialization intended for a project source root should create files only beneath a canonical, trusted eval directory. A source directory escaping through a symlink should be rejected before scaffold creation.

## Impact

A crafted project or caller-supplied state directory can redirect a routine eval initialization operation into external storage, creating multiple configuration and executable test files outside the expected project boundary.
