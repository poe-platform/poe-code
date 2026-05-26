# Process log writer follows a symlinked log directory and writes and rotates external logs

## Summary

The exported `@poe-code/process-launcher` log writer appends and rotates managed process logs beneath a configured `logDir` without rejecting symbolic links. A symlinked log directory redirects output persistence and rotation into an external location.

## Reproduction

1. From the repository root, run this disposable log-output probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-process-log-probe.XXXXXX)
   mkdir -p "$probe/project/logs" "$probe/outside"
   ln -s "$probe/outside" "$probe/project/logs/linked"
   cat > "$probe/repro.mts" <<EOF
   import { createLogWriter } from "${workspace}/packages/process-launcher/src/logs/log-writer.ts";
   const writer = createLogWriter("${probe}/project/logs/linked", 1);
   await writer.write("external write", "stdout");
   console.log((await writer.tail("stdout", 5)).join("|"));
   await writer.rotate();
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/logs/linked"
   find "$probe/outside" -maxdepth 1 -type f -print | sort
   cat "$probe/outside/stdout.1.log"
   ```

## Observed Behavior

The project-facing log directory resolves externally. Writing a normal stdout line stores it externally, `tail()` reads it back, and rotation moves it into external `stdout.1.log`.

`packages/process-launcher/src/logs/log-writer.ts:10` through `packages/process-launcher/src/logs/log-writer.ts:49` derive and move log files, while `packages/process-launcher/src/logs/log-writer.ts:109` through `packages/process-launcher/src/logs/log-writer.ts:170` append, rotate, and read logs beneath the unchecked directory.

## Expected Behavior

Managed process logs should be written, read, and rotated only beneath canonical process state log directories. A symlinked log directory escaping that boundary should be rejected.

## Impact

A crafted managed-process state entry can redirect command output into external files and manipulate external rotated log history during ordinary process execution or restart flows.
