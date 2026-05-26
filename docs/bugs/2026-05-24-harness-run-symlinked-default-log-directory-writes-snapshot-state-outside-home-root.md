# Harness run follows a symlinked default log directory and writes snapshot state outside the home root

## Summary

`runHarnessPair()` derives its default snapshot location below `<home>/.poe-code/logs/harness/<plan-slug>`, but does not reject a symbolic link at the slug directory. If that directory points outside the Poe Code state root, an interrupted harness run writes both its snapshot and replayable host-call data into the external target.

## Reproduction

From the repository root, place a minimal harness pair in a disposable project, redirect its default `probe` run-log directory externally, and interrupt the run after its first resumable host interaction:

```sh
repo=$PWD
probe=$(mktemp -d)
mkdir -p "$probe/project" "$probe/home/.poe-code/logs/harness" "$probe/outside"
ln -s "$probe/outside" "$probe/home/.poe-code/logs/harness/probe"

cat > "$probe/project/probe.md" <<'EOF'
---
kind: probe
version: 1
---
EOF
cat > "$probe/project/probe.ajs" <<'EOF'
import { step } from "host";
export default async () => {
  const first = await step("first");
  await step("second");
  return first;
};
EOF

cat > "$probe/repro.mts" <<EOF
import { runHarnessPair } from "file://$PWD/packages/agent-harness/src/loader/run.ts";

const controller = new AbortController();
let releaseSecond: ((value: string) => void) | undefined;
const pendingSecond = new Promise<string>((resolve) => { releaseSecond = resolve; });
const running = runHarnessPair("$probe/project/probe.md", {
  modulesFor: () => ({
    host: {
      async step(name: string) {
        if (name === "first") return "alpha";
        return pendingSecond;
      }
    }
  }),
  signal: controller.signal,
  snapshotIntervalMs: 1
});

await new Promise((resolve) => setTimeout(resolve, 150));
controller.abort();
releaseSecond?.("late");
try { await running; } catch (error) { console.log("error=" + (error as Error).name); }
EOF

HOME="$probe/home" "$repo/node_modules/.bin/tsx" "$probe/repro.mts"
ls -ld "$probe/home/.poe-code/logs/harness/probe"
find "$probe/outside" -maxdepth 1 -type f -print
sed -n '1,20p' "$probe/outside/snapshot.json.host-calls.json"

nl -ba packages/agent-harness-tools/src/run-logs.ts | sed -n '1,20p'
nl -ba packages/agent-harness/src/loader/run.ts | sed -n '78,118p;501,569p;602,613p'
```

## Observed Behavior

The default snapshot directory resolves textually under the home state root, but the write follows its symlink target and materializes resumable run state externally:

```text
error=AbortError
<probe>/home/.poe-code/logs/harness/probe -> <probe>/outside
<probe>/outside/snapshot.json
<probe>/outside/snapshot.json.host-calls.json
[
  {
    "key": "host.step",
    "args": ["first"],
    "result": "alpha"
  }
]
```

`resolveSnapshotPath()` chooses `resolveRunLogDir({ runner: "harness" })/snapshot.json`; `FileSnapshotBackend` writes the snapshot through that path, while `writeHostCallRecords()` writes the sibling host-call cache without canonical containment validation.

## Expected Behavior

Default harness snapshot and host-call storage should remain canonically within the selected user's `.poe-code/logs/harness` state root. A symlinked per-plan log directory escaping that root should be rejected rather than used for persistence.

## Impact

Running a harness pair can write execution snapshots and recorded host-call arguments or results outside the intended state directory. Depending on the harness modules, those external files may contain sensitive run state or operation results and can subsequently influence resume behavior.
