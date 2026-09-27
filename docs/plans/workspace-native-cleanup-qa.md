# Workspace native four-process cleanup QA

Exercise the maintained finite workspace unit runner with four actual detached Node child process groups. This is native lifecycle QA: deterministic mocked primary-error, STOP, escalation, join, queued-unit and cleanup-error cases remain in `scripts/build-workspaces.test.ts`.

Create a temporary fixture matching `unitFixture` with root and five declared workspace unit tasks, and the maintained dependency graph. Start the runner at concurrency four using a supervisor host with real process-group signalling. Each child sends a ready IPC message, then remains alive. Wait for four children and all ready messages.

1. Trigger a falsey primary failure by emitting the exact value `false` on child two's error event. Verify the runner rejects with the identical value, joins all four children, observes exactly one close per child, starts no fifth task, and removes its SIGTERM listener.
2. Repeat with four fresh groups, emitting SIGTERM on the supervisor host. Verify rejection identifies interruption, joins all four groups with one close each, starts no fifth task, and removes its SIGTERM listener.
3. After each scenario, verify signalling every negative child PID with signal zero fails because the process group is absent. In cleanup, signal only these owned negative PIDs with SIGTERM, escalate to SIGKILL after two seconds if needed, await all close events, and remove only the owned fixture.

Verification: both original native scenarios and every original assertion passed on 26 September 2026 in 312 ms total under their unchanged 15-second deadlines. The full default-mode suite had exposed an external-startup timeout lasting 43 seconds. Keep this native coverage in agent-executed QA rather than the fast unit route.
