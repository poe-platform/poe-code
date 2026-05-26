# Process launcher supervisor replacement launch error is unhandled

## Summary

When a supervised process fails under a restart policy and the replacement `runner.exec()` throws, `createSupervisor()` propagates that exception only through its detached `monitorExit()` promise. No public operation is awaiting the automatic recovery path, so replacement launch failure becomes an unhandled rejection and the supervisor remains indefinitely in `restarting` state with no live process.

## Reproduction

From the repository root, launch one mock process that exits non-zero and configure the runner to throw when the supervisor automatically attempts its replacement:

```sh
cat > /tmp/process-launcher-supervisor-restart-launch-throws-unhandled-probe.mjs <<'EOF'
import { createSupervisor } from "/Users/kjopek/Workspace/poe-code/packages/process-launcher/dist/index.js";

let firstResolve;
const unhandled = [];
process.on("unhandledRejection", (error) => {
  unhandled.push(error instanceof Error ? error.message : String(error));
});
let execCount = 0;
const supervisor = createSupervisor({
  stateDir: "/tmp/supervisor-restart-launch-throws-state",
  spec: { id: "job", command: "server", restart: "on-failure", backoffMs: 0 },
  runner: {
    name: "host",
    exec() {
      execCount += 1;
      if (execCount === 2) throw new Error("replacement launch failed");
      return {
        pid: 101,
        stdout: null,
        stderr: null,
        stdin: null,
        result: new Promise((resolve) => { firstResolve = resolve; }),
        kill() {}
      };
    }
  }
});

await supervisor.start();
firstResolve({ exitCode: 1 });
await new Promise((resolve) => setTimeout(resolve, 15));
console.log("state=" + JSON.stringify(supervisor.getState()));
console.log("execCount=" + execCount);
console.log("unhandled=" + JSON.stringify(unhandled));
process.exit(0);
EOF

node /tmp/process-launcher-supervisor-restart-launch-throws-unhandled-probe.mjs

nl -ba packages/process-launcher/src/supervisor/supervisor.ts | sed -n '109,119p;159,218p'
```

## Observed Behavior

The failed original process is moved to a restart state, but the replacement cannot launch. Its exception escapes as an unhandled rejection while the supervisor continues reporting `restarting` with no PID:

```text
state={"id":"job","pid":null,"status":"restarting","runtime":"host","restartCount":1,"lastExitCode":1,"lastStartedAt":"...","lastStoppedAt":"...","command":"server","args":[]}
execCount=2
unhandled=["replacement launch failed"]
```

`packages/process-launcher/src/supervisor/supervisor.ts:159` through `packages/process-launcher/src/supervisor/supervisor.ts:218` run automatic recovery inside `monitorExit()`, including `await launch(true)`. `packages/process-launcher/src/supervisor/supervisor.ts:109` through `packages/process-launcher/src/supervisor/supervisor.ts:119` reject when replacement `runner.exec()` throws. Since the monitor was originally launched with `void monitorExit(...)`, no public caller observes or handles the replacement failure.

## Expected Behavior

Automatic replacement launch errors should transition the supervisor to a truthful terminal failure state and surface through a controlled error/reporting channel. They should not become unhandled promise rejections while leaving recovery permanently pending.

## Impact

Missing binaries, exhausted execution backends, or transient launch failures during restart can crash embedding applications configured to fail on unhandled rejections and leave process state falsely implying recovery is still underway. Operators receive neither a running replacement nor a deterministic crashed result.
