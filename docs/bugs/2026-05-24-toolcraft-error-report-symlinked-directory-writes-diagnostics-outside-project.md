# Toolcraft error report follows a symlinked directory and writes diagnostics outside the project

## Summary

`writeErrorReport()` persists diagnostics beneath `<project>/.toolcraft/errors` by default, but does not reject a symbolic link at that directory. A project-local error reporting configuration can therefore redirect detailed error artifacts into an external location.

## Reproduction

From the repository root, link a disposable project's default Toolcraft error directory externally and emit a harmless diagnostic through the exported API:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project/.toolcraft" "$probe/outside"
ln -s "$probe/outside" "$probe/project/.toolcraft/errors"

cat > "$probe/repro.mts" <<EOF
import { writeErrorReport } from "file://$PWD/packages/toolcraft/src/error-report.ts";

console.log(JSON.stringify(await writeErrorReport({
  error: new Error("external diagnostic"),
  projectRoot: "$probe/project",
  errorReports: true,
  commandPath: "probe"
})));
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -l "$probe/project/.toolcraft/errors"
find "$probe/outside" -maxdepth 1 -type f -print -exec head -5 {} \;

nl -ba packages/toolcraft/src/error-report.ts | sed -n '99,107p;460,484p'
```

## Observed Behavior

The returned display path describes a project-local diagnostic, while the actual report file is created in the external symlink target:

```text
{"absolutePath":"<probe>/project/.toolcraft/errors/<timestamp>-probe.log","displayPath":".toolcraft/errors/<timestamp>-probe.log"}
<probe>/project/.toolcraft/errors -> <probe>/outside
<probe>/outside/<timestamp>-probe.log begins with: Toolcraft Error Report
```

## Expected Behavior

Default Toolcraft error reports should be written only to canonical files contained within the selected project's `.toolcraft/errors` directory. A symlinked report directory escaping the project should be rejected before persisting diagnostics.

## Impact

Failure handling can leak command arguments, redacted environment metadata, stack traces, and HTTP transcript content outside the project state directory, while reporting the artifact as a normal project-local error log.
