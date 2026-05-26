# Toolcraft error reporting follows a symlinked default directory and writes outside the project

## Summary

Toolcraft's error-report writer places generated diagnostic logs beneath the default project path `.toolcraft/errors` without rejecting symbolic links. A symlinked default report directory redirects error logs outside the project while the returned display path still appears project-local.

## Reproduction

1. From the repository root, run this disposable project-fixture probe:

   ```sh
   workspace=$PWD
   probe=$(mktemp -d /tmp/poe-toolcraft-report-probe.XXXXXX)
   mkdir -p "$probe/project/.toolcraft" "$probe/outside"
   ln -s "$probe/outside" "$probe/project/.toolcraft/errors"
   cat > "$probe/repro.mts" <<EOF
   import { writeErrorReport } from "${workspace}/packages/toolcraft/src/error-report.ts";
   const result = await writeErrorReport({
     projectRoot: "${probe}/project",
     errorReports: true,
     error: new Error("probe failure"),
     argv: ["probe"],
     commandPath: "run"
   });
   console.log(JSON.stringify(result));
   EOF

   "$workspace/node_modules/.bin/tsx" "$probe/repro.mts"
   realpath "$probe/project/.toolcraft/errors"
   find "$probe/outside" -type f -print
   ```

## Observed Behavior

`writeErrorReport()` returns an apparent project-relative display location beneath `.toolcraft/errors`, but the generated timestamped `.log` file is created in the external symlink target.

`packages/toolcraft/src/error-report.ts:460` through `packages/toolcraft/src/error-report.ts:480` choose the default report directory, create it, and write a diagnostic report without verifying its canonical containment inside the selected project root.

## Expected Behavior

Default Toolcraft error reports should be written only to canonical state locations within the project. A `.toolcraft/errors` path that resolves externally should be rejected before diagnostics are persisted.

## Impact

A crafted project can redirect error transcripts outside its state tree. Reports may contain parsed parameters, stack traces, structured fields, and HTTP transcript content, creating out-of-scope writes and potential disclosure of operational data.
