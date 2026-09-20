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
| Replay deterministic runs and timed stream output | `createMockRunner`, `createMockRunnerByCommand` |
| Read filtered build-context files and binary bytes | `readDockerBuildContextFiles` |
| Upload and download workspaces with rollback and conflict checks | `uploadWorkspace`, `downloadWorkspace` |

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
uses std and the repository's own JSON and SHA cores; the single napi-rs addon is the only
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

Mock runners replay a shallow copy of behaviors or look up live own command
entries. Consumed FIFO slots release their behavior references. Output completes
before the default result; explicit exit delays may finish earlier. Repeated kill
stops streams and settles once without rereading the exit-code getter.

Build contexts use an own Rust ignore matcher with no regex dependency. It covers
anchoring, directory rules, parent exclusion, negation, globstars, classes and
case folding. The Node filesystem transport skips symlinks, preserves file bytes
and sorts relative paths with Node locale ordering. `.dockerignore` always stays
in the file list. The SDK `docker/build-context` and `testing` subpaths are also
available on this package.

This is an additive experimental process and workspace subset. Docker environments,
full malformed/getter fidelity and
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

Matcher construction plus12 path checks measured9.8µs native versus3.9µs for the
SDK reference. After131,072 further cycles, native heap stayed3.84–3.87MB and RSS
111.8–112.4MB; the reference stayed4.00–4.04MB and59.9–62.8MB. These results do
not establish a performance or total-memory improvement. Full malformed-pattern
error parity, including a reference-library `SyntaxError` case, remains unfinished.

The portable core also provides a deterministic USTAR encoder for workspace
transfer. It borrows input payloads, checks UTF-8 path limits and preserves original
UTF-16 error text. The Node binding returns Node-owned archive buffers. For a
two-entry6.5KiB archive, a bounded comparison measured1.8–2.1µs native versus
9.3–10.2µs for the SDK encoder. Sampled RSS stayed82–84MB across131,072 further
encodes; the SDK stayed58MB.

Workspace uploads stage files and archives before promotion. Rust owns the
mutation and rollback order, ordered ignore rules, SHA-256 content state, size
admission, conflict checks and remote-deletion candidates. Node executes builtin
filesystem operations and keeps payload buffers outside retained native state.
Downloads refuse or overwrite local conflicts, reject symlinks and use exclusive
temporary writes followed by rename. Download traversal and filesystem sequencing
currently remain in Node transport.

A bounded three-file upload/download comparison measured248–321µs per native
pair versus239–443µs SDK. Across4096 more pairs, native sampled heap grew
6.86→7.17MB and SDK6.98→7.40MB; both ended near120MB RSS and74KB live buffers.
The memory fixture releases only unreachable development memfs inodes at sample
checkpoints. Direct and packed16MiB workers pass;8MiB workers exhaust the heap
with the development filesystem loaded. These results establish neither a broad
performance gain nor lower total memory use.
