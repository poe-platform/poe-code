# Runtime job registry follows a symlinked state directory and reads, writes, or deletes external job files

## Summary

The exported runtime job registry stores job entries beneath `<home>/.poe-code/state/jobs`, but it performs filesystem operations without checking whether that directory remains inside the supplied home-state root. If the `jobs` directory is a symbolic link to an external directory, normal `put()`, `list()`, and `remove()` operations create, disclose, and delete external job JSON files.

## Reproduction

From the repository root, invoke the exported state manager with a disposable home whose job directory points externally:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/home/.poe-code/state" "$probe/outside/jobs"
ln -s "$probe/outside/jobs" "$probe/home/.poe-code/state/jobs"

cat > "$probe/repro.mts" <<EOF
import { readFile, stat } from "node:fs/promises";
import { createStateManager } from "file://$PWD/packages/poe-code-config/src/state/index.ts";

const state = createStateManager("$probe/home");
await state.jobs.put({
  id: "job-probe",
  env_id: "env",
  env_kind: "docker",
  tool: "runtime",
  argv: ["run"],
  cwd: "/tmp",
  started_at: "2026-05-24T00:00:00.000Z",
  status: "running"
});
console.log("job=" + await readFile("$probe/outside/jobs/job-probe.json", "utf8"));
console.log("listed=" + JSON.stringify(await state.jobs.list()));
await state.jobs.remove("job-probe");
try { await stat("$probe/outside/jobs/job-probe.json"); console.log("remaining=true"); }
catch { console.log("remaining=false"); }
EOF

"$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/state/jobs"

nl -ba packages/poe-code-config/src/state/jobs.ts | sed -n '36,170p'
```

## Observed Behavior

The registry writes its generated job entry in the external target, includes that external file in job listings, and removes it during ordinary cleanup:

```text
<probe>/home/.poe-code/state/jobs -> <probe>/outside/jobs
job={
  "id": "job-probe",
  ...
  "status": "running"
}
listed=[{"id":"job-probe",...,"status":"running"}]
remaining=false
```

`createJobRegistry()` constructs `jobsDir` beneath the supplied home. `put()` creates and atomically renames the job file there, `list()` enumerates and reads child JSON files, and `remove()` unlinks the generated job path; each operation follows an existing directory symlink.

## Expected Behavior

Runtime job state associated with a selected home directory should remain canonically contained within `<home>/.poe-code/state/jobs`. The registry should reject symlink-mediated escapes or otherwise prevent job lifecycle operations from reaching external files.

## Impact

An attacker or corrupted local state able to link the runtime jobs directory externally can redirect persisted runtime command metadata outside poe-code's state root, inject external job entries into listings, and cause normal cleanup operations to delete external JSON files.
