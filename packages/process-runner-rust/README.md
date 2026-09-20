# process-runner-rust

Run host commands through the same Node streams and cancellation API, with
independent Rust execution policies and no npm runtime dependencies.

| Capability | Node API |
| --- | --- |
| Spawn commands, preserve stdout/stderr and return exit codes | `createHostRunner` |
| Run Docker/Podman containers and control cancellation | `createDockerRunner` |
| Cancel with AbortSignal or signal a child/process group | `RunHandle.kill` |
| Open host environments and select interactive shell defaults | `hostExecutionEnvFactory` |
| Select Docker/Podman and discover running Colima profiles | `detectEngine`, `isEngineAvailable`, `detectContext` |
| Add a Docker context while keeping Podman arguments unchanged | `buildContextArgs` |

```typescript
import { createHostRunner } from '@poe-code/process-runner-rust';

const run = createHostRunner().exec({
  command: 'git', args: ['status', '--short'], stdout: 'pipe'
});
for await (const chunk of run.stdout!) process.stdout.write(chunk);
const { exitCode } = await run.result;
```

Stdin defaults to ignored input; stdout and stderr default to pipes. Explicit
environment maps replace the inherited environment. Detached runs and runs with
`killProcessGroup` signal the full process group on Unix and the child on Windows.
Already-aborted runs do not spawn or validate unused transport options. Process
errors and signal termination return exit code1; ordinary nonzero codes survive.
Result settlement and cancellation-listener removal happen once.

The own Node transport uses builtin child processes and retains stream, signal
and environment identities. Rust owns active-run stdio/group planning, result
admission, signal-target selection and lazy shell fallback order. The Rust core
uses std and the repository's own JSON core; the single napi-rs addon is the only
native artifact. Rust also owns Docker argument ordering, port validation and
environment-file serialization for the Docker runner. Environment
values remain outside process arguments, and strings preserve UTF-16 code units.

Host environments do not transfer workspace files or detach/reattach. Their shell
uses own shell-spec overrides before configured/system defaults and never reads
unused fallback getters. An explicit shell environment remains separate from its
command fallback environment.

Docker commands remain in the foreground. `kill()` issues container stop/kill
commands; abort issues stop, waits for the host process to exit, and overrides
its result to1. If it stays alive, abort signals the host process with SIGTERM
after10 seconds and SIGKILL5 seconds later. Settlement removes listeners, clears
timers and cleans private environment files once. Interactive inherited stdio
requires all three streams plus `tty:true`; piped streams retain their identities.

This is an additive experimental host and Docker-runner subset. Docker environments,
workspace transfer, mock-runner helpers, full malformed/getter fidelity and
cross-platform artifacts remain in progress. Existing applications keep their
original TypeScript imports. Bounded cancellation measurements are not general
process performance or memory acceptance.

A bounded Docker-argument/environment serialization workload measured about5.18µs
per native cycle versus0.54–1.00µs for the SDK. Native heap stayed near4.1MB across
262,144 further cycles; buffers stayed10.5KB. Direct and packed8MiB workers pass,
with external package imports blocked. Small calls currently pay binding overhead;
these results do not establish a general performance improvement.

Simulated Docker process/abort cycles measured6.4–9.3µs native versus2.6–5.6µs
SDK. Across65,536 more simulated runs, native sampled heap stayed5.0–5.1MB and
buffers16.6KB. These checks use a deterministic process transport; real Docker
engine and detached-environment verification remain unfinished.
