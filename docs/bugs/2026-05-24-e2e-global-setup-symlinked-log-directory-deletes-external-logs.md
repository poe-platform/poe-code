# E2E global setup follows a symlinked log directory and deletes external logs

## Summary

The `@poe-code/e2e-test-runner` global Vitest setup rotates files beneath a configured `logsDir` without rejecting symbolic links. A symlinked log directory redirects normal rotation cleanup into an external directory and deletes external `.log` files.

## Reproduction

1. From the repository root, run this disposable setup probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-e2e-log-rotate-probe.XXXXXX)
   mkdir -p "$probe/project" "$probe/outside"
   printf 'old\n' > "$probe/outside/old.log"
   sleep 0.02
   printf 'new\n' > "$probe/outside/new.log"
   ln -s "$probe/outside" "$probe/project/logs"
   cat > "$probe/repro.mts" <<EOF
   import { createGlobalSetup } from "${workspace}/packages/e2e-test-runner/src/vitest.ts";
   await createGlobalSetup({ logsDir: "${probe}/project/logs", maxLogs: 1 })();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/logs"
   find "$probe/outside" -maxdepth 1 -type f -print | sort
   ```

## Observed Behavior

Global setup prints `Rotated 1 old log file(s).` and removes the external `old.log` file through the project-local-looking `logs` symlink, leaving only `new.log` in the external directory.

`packages/e2e-test-runner/src/vitest.ts:11` through `packages/e2e-test-runner/src/vitest.ts:26` accept and initialize the configured log directory before invoking rotation. `packages/e2e-test-runner/src/log-rotation.ts:6` through `packages/e2e-test-runner/src/log-rotation.ts:35` enumerate, sort, and unlink log files through that unchecked directory.

## Expected Behavior

E2E log rotation should delete files only beneath a canonical log directory selected for the test run. A symlinked `logsDir` resolving outside the intended location should be rejected before rotation.

## Impact

A crafted test configuration or replaced workspace log directory can cause routine E2E startup to delete external log files with the privileges of the developer or CI job.
