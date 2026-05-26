# Memory initialization follows a symlinked memory root and writes scaffold files outside the project

## Summary

The `@poe-code/memory` initialization API resolves the default project memory location textually beneath `.poe-code/memory` and creates its scaffold without rejecting symbolic links. A symlinked memory root redirects `INDEX.md`, `LOG.md`, and `pages/` outside the project.

## Reproduction

1. From the repository root, run this disposable project-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-memory-init-root-probe.XXXXXX)
   mkdir -p "$probe/project/.poe-code" "$probe/outside"
   ln -s "$probe/outside" "$probe/project/.poe-code/memory"
   cat > "$probe/repro.mts" <<EOF
   import { initMemory, resolveMemoryRoot } from "${workspace}/packages/memory/src/index.ts";
   const root = resolveMemoryRoot("${probe}/project");
   console.log(root);
   await initMemory(root);
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.poe-code/memory"
   find "$probe/outside" -maxdepth 2 -print | sort
   ```

## Observed Behavior

The resolved memory root textually points inside the project, but its symlink target is external. `initMemory()` creates external `INDEX.md`, `LOG.md`, and `pages/` entries beneath that target.

`packages/memory/src/paths.ts:18` through `packages/memory/src/paths.ts:20` construct the default memory root, while `packages/memory/src/init.ts:10` through `packages/memory/src/init.ts:23` create and write scaffold entries through it without canonical-containment or symlink checks.

## Expected Behavior

Memory initialization should create project state only beneath the canonical project `.poe-code/memory` directory. A symlinked memory root escaping the project should be rejected before writing files or directories.

## Impact

A crafted project or replaced memory-state entry can cause ordinary memory setup to create or overwrite state files outside the project boundary with the invoking user's privileges.
