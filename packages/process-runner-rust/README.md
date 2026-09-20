# process-runner-rust

Run host commands through the same Node streams and cancellation API, with
independent Rust execution policies and no npm runtime dependencies.

| Capability | Node API |
| --- | --- |
| Spawn commands, preserve stdout/stderr and return exit codes | `createHostRunner` |
| Cancel with AbortSignal or signal a child/process group | `RunHandle.kill` |
| Open host environments and select interactive shell defaults | `hostExecutionEnvFactory` |

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
has no dependencies; the single napi-rs addon is the only native artifact.

Host environments do not transfer workspace files or detach/reattach. Their shell
uses own shell-spec overrides before configured/system defaults and never reads
unused fallback getters. An explicit shell environment remains separate from its
command fallback environment.

This is an additive experimental host subset. Docker engines/runners/environments,
workspace transfer, mock-runner helpers, full malformed/getter fidelity and
cross-platform artifacts remain in progress. Existing applications keep their
original TypeScript imports. Bounded cancellation measurements are not general
process performance or memory acceptance.
