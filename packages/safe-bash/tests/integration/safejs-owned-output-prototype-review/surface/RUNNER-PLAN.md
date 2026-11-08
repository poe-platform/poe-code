# Release-gated execution plan

This is a plan, not an executed runner. All guest text is inert `.guest.txt`
data, outside canonical TypeScript discovery. Eight unconditional cases are
frozen; the ninth is conditional and is not a pass when unneeded. No other
cohort, native oracle, mutation, lifecycle suite, or environment work is allowed.

## Preconditions before any import

1. Obtain ROOT's explicit receipt-review release, recording its reference and
   this freeze commit. Neither a readable `/tmp` receipt nor the preparer seal
   is that release. Verify `FREEZE.json`, the pinned provenance Git objects,
   and all 940 candidate files and 709 public package files again. Read changes
   in live public source separately; do not overlay them or require equality
   with this historical prototype.
2. Inspect applicable private AGENTS, then use `GIT_OPTIONAL_LOCKS=0` for every
   private Git query. Record fresh HEAD/tree/index bytes/hash/metadata,
   status/staging and the six metadata inputs covered by the preparer snapshot.
   Hash all 264 regular engine files. Require the pinned bb23ec2 identity and
   source bytes; report drift as a blocker rather than changing the profile.
   Repeat the complete private snapshot after all owned activity, including a
   failed run. This preparation makes no fresh live-private assertion.
3. Create a unique owned `/private/tmp` directory using regular files only.
   Copy the freshly checked 264 engine files, the authenticated existing copied
   loader and tooling, the full candidate, and the actual public copied package.
   Reject symlinks in every component and entries that are not regular files
   or directories. Record each source path/hash and destination path/hash;
   copies must preserve bytes. No shared-scratch writes, live source imports,
   private cache/tsbuildinfo, engine build, install, worktree, or upstream patch.
4. Use the pinned Node 22.22.2 binary. Load the public prototype by the actual
   copied package exports, not product TS fallback. Hook entries are copied
   `src/run.ts`, `src/interp/budget.ts`, `src/modules/fs.ts`, and
   `src/interp/host-bridge.ts`; use their real `run`, `Budget`, `makeFsModule`,
   and `declareHostOperation`. Never use the private barrel or default ambient
   filesystem. The existing loader transpiles unchanged TS bytes in memory
   using copied TypeScript 5.9.3; it does not build the engine.
5. Before executing, hash/freeze the new orchestration separately. Preserve
   these guest inputs and criteria unchanged. Audit actual loaded module paths
   and original-byte hashes against the full candidate/package/engine/tool
   inventories, not merely the 63-file static engine graph. Record compiler
   output identity separately from source identity. No external package or
   source fallback; no `NODE_OPTIONS` preload, inherited credentials, or implicit
   network/host execution. Copied TypeScript's actual loaded file is audited;
   copied type packages are provenance, not claimed runtime imports.

## Legitimate host premise and facade path

Use a fresh public `MemoryFileSystem`, `/work/input` containing `seed\n`, cwd
`/work`, environment `{ TAG: "surface" }`, and stdin `surface-input` for each
case. Shell's ordinary exported `PWD=/work` is expected; do not use replaceEnv
or change caller identity to simplify the expected shape.

Create a public `createBytePipe` with highWaterMark 1024 and an explicit caller
signal. Start one bounded continuous collector before invocation (65536 bytes
maximum). Use its real writable as `Shell.exec`'s external stdout. Do not cancel
the consumer early or run a first-read worker probe. Its real `ownedOutput`
must survive the Shell capture/budget sink into the command context. Record
consumer signal identity and descriptor/type observations; fail the premise if
metadata is absent. Do not fabricate metadata to pass this assertion.

Obtain the real definition from `createSafeJsCommands({ runtime, limits })`.
Register exactly one public adapter definition with the same name and handler
contract, using `Shell.register`. Its handler receives the real Shell context,
asserts `context.stdout.ownedOutput.consumerClosed instanceof AbortSignal` and
that its accounted `write` is callable, then creates the real
`createOutputOperation(context, context.stdout)`. Record the six operation
members, its signal, and the sole `output.write` member. No invented
`next(replacementContext)` API: actual middleware `next` takes no arguments.

For a finite, host-only premise, call `operation.acquire` once with an immediate
token and immediate release counter; register one immediate cleanup counter;
create one explicit child and register its immediate cleanup counter. No timer,
worker, external resource, or guest callback is involved in these premises.
Call the unchanged real definition with `{ ...context, stdout: operation.output }`.
Keep all other fields, especially `invoke`, `signal`, `registerCleanup`, FS,
env, args, stdin and origin, unchanged. Always await the same `operation.close`
in finally. Record each of the three final counters as exactly one, but do not
call this full lifecycle acceptance. Record metadata/output function identities
at the handoff; the output adapter must not bypass the original accounted sink.

Dispatch through one literal public command adapter `surface-entry` whose real
handler calls `context.invoke("safejs", ["-e", exactSource, "--", "surface-arg"])`.
Run `Shell.exec("surface-entry", { stdin, stdout, signal })`. No shell quoting
of guest code, direct fake CommandContext, stub interpreter, or print flag.
Record exact source UTF-8 bytes/hash and final argv at the real safejs handler.

The runtime observer records the source/options/budget/signal and forwards
unchanged to the actual engine. It records the actual returned result rather
than serializing functions into a guest grant. The only exception is case 04:
add one legitimate `makeSafeJsShellModule`, using an explicit inner public Shell,
the same VFS and supplied signal, `read-side-effect`, and actual
`declareHostOperation`. Install `standardCommands` for its literal `printf`;
do not execute grep, regex workers, native tools, or extra probe commands.
Forward validated cwd/env/stdin to that inner Shell; return only the public
bridge's stdout/stderr/exitCode whitelist. Dispose both Shell instances.

Before calling the engine, inspect own descriptors and at most two prototype
levels of the actual module namespaces and selected callables using host
reflection without invoking getters. Record symbol/name/type/enumerability and
identity comparisons to the known context, metadata, operation and its methods.
Do not traverse ambient Function/Object constructors or expose these records
to the guest. Host prototype inheritance is not evidence of guest inheritance.
The copied bridge deliberately copies own function-valued data descriptors;
therefore inspect callable properties as well as namespaces. Never append
cleanup/operation functions to a facade as a positive control.

## Field-level outcomes and effects

`CASES.json` gives exact namespace keys, allowed `write` slots, missing-sensitive
fields, return payloads, shell status/output, and VFS effects. `stdio.write`
is a legitimate callable, not an owned-output leak. `call`/`apply` are legitimate
function methods; their presence alone is not host authority. Check each row,
not `all false == pass`. Capture every actual field even on a mismatch.

Guest `Object.keys`, `entries`, `hasOwn`, namespace spread and `Object.assign`
have separate positive premises. `Reflect` and descriptor/prototype helper
absence is only a dialect observation. Case 08's function-spread error is
unsupported-operation evidence, never a substitute for case 03 namespace
spread. Parse failure, unsupported syntax, empty result, budget exhaustion,
wrong source, or missing positive premise is not a successful denial.

Cases 05/06 deliberately call an observed undefined member with finite callback
arguments. They catch and return the exact non-function diagnostic plus local
callback counters; their successful command status alone is not a denial pass.
Any present member is returned as a discrepancy instead of invoked. No extra
host registration/acquisition or VFS/output effect is expected. The host-only
premise counters remain distinguishable from the measured guest counters; no
private cleanup-queue inspection is claimed.

If field/descriptor evidence identifies an actual host function path, stop
normal progression and notify ROOT before effects, recording path, exact probe
output, source hashes, runtime/loaded-import identity and host positive premise.
Only frozen case 09 may then run for its exact `stdio.write.registerCleanup`
path if identity/source evidence establishes that premise. It registers one
finite throwing marker callback, once; no loop, retry, opaque promise, or
injected host reporter. Record registration outcome, marker occurrence, and
any lifecycle rejection. A disabled late callback is not proof that authority
executed. Other paths require ROOT review of a separately frozen finite proof;
do not expand this cohort or manufacture raw-host grants.

## Deadlines, cleanup, and evidence

- Each guest runs in its own directly owned Node child, never the parent.
  Fixed absolute 10000 ms deadline starts at spawn and is never extended.
  The whole cohort has a 100000 ms absolute deadline. Cases run once, sequentially;
  infrastructure failures remain raw attempts, not retried away.
- SafeJS limits: maxSourceBytes 65536, maxInputBytes 4096, maxOutputBytes 65536,
  timeoutMs 2000, maxSteps 20000, maxCallDepth 64, stringLength 65536,
  arrayLength 4096, dataSize 1048576. Shell limits: maxOutputBytes 65536,
  maxCommands 8, maxLoopIterations 8, maxSubstitutionDepth 4,
  maxSourceBytes 65536, maxExpansionFields 64, maxExpansionBytes 65536,
  pipeHighWaterMark 1024. No budget waivers/resume or synthetic abort overrides.
- Keep an owned PID/worker/service ledger. No worker/esbuild service is expected
  from these cases or the TypeScript loader. Treat any unexpected owned handle
  as an infrastructure failure and close only positively identified owned
  handles. No `pkill`/foreign kills. Deadline enforcement may terminate known
  owned children to protect the parent, but **watchdog rescue never passes**.
- Record child stdout/stderr, natural exit versus signal/deadline, engine
  result/error own fields and stack, command result/bytes, exact guest return
  value, context/abort observations, host premise markers, all VFS before/after
  bytes, and actual loaded paths/hashes. Preserve parent-alive evidence even for
  failed cases. No callback result or cancelled case is silently normalized.
- Close operation/child, close the pipe normally after command completion,
  await collector and Shell disposal, and require natural child exit. Compare
  full copied candidate/package/engine/tool inventories before and after; repeat
  fresh private guards even on failure. Verify no known owned child/worker/service
  remains, then remove only owned scratch after saving evidence.

The source plan and static hash check are the only activities authorized now.
The private before/after/import audit, actual host positives, parser acceptance,
and every runtime expectation remain **pending release**.
