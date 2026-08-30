# Env-S fixture validity v1 — frozen author inputs

This is a bounded fixture revision, not a product change or independent
acceptance. The only writable repository directory is this one. Product source
is `84ab66ca717e0dff21abf57051b41cb553f3c7f3`; source-author evidence is
`a84dd195`, hidden review `36425fc6e066c23b55bd17eb517931efb4706aa7`, and packed
review `b44fa142a0da9593df533c56fd149cb38603ea68`. All original helpers, cases,
captures and failures stay in their original directories, unchanged and hashed.

`DELTAS.txt` contains exactly three fixture defects and exactly three full
literal-argv native/virtual command diagnostic tuples. `original-revised.diff`
is the complete original-to-revised diff for all copied fixture modules.
`original-observations.json` preserves original primary tuples and raw thrown
assertions without inventing unrecorded inner stderr. `freeze-v1.json` freezes
all revised inputs/assertions, original artifact hashes, source identity, and
the three additional virtual diagnostic profiles BEFORE any product execution.

## Binding changes, not golden changes

1. Hidden `hosts.mjs:25`: raw `Uint8Array` becomes an explicitly empty async
   generator. `stdinIsDefault:false`, literal argv, replacement environment,
   captures, middleware and parent assertions remain unchanged. Status zero and
   empty stderr are additionally asserted. The helper import binds to an exact
   copy of the already-disclosed setup-v2 byte helper; no new VFS setup change.
2. Consumer per-exec state: remove the separate setup and verification execs.
   The single revised exec is exactly:

   ```text
   SECRET=parent-local; export PUBLIC=parent-public; parentbefore "$SECRET" "$PUBLIC"; ORIGINAL_SOURCE; parentafter "$SECRET" "$PUBLIC" "$?"
   ```

   `ORIGINAL_SOURCE` is byte-identical to the original selected command/source.
   Native env argv, headers, script bodies, stdin and native expected tuples are
   unchanged. Boundary commands capture actual expanded local values and exact
   exports without writing any bytes/files. The final boundary returns the
   actual primary status, preserving the original tuple rather than replacing
   errors with zero. A malformed-source125, dispatch126/127 or shebang failure
   still executes and remains raw. This is a changed harness shell source, NOT
   a claim of unchanged fixture input. All changes are explicit in the diff.

   Budget setup consumes exactly three shell commands: assignment, export and
   `parentbefore`. Original maxCommands4 becomes7, leaving exactly4 commands for
   the original entry/env/forward/tick work. The second tick must still fail;
   exact reached middleware commands, `ShellLimitError.limit` and ticks remain
   asserted. No resource budget is reset or replaced. No after-command runs when
   budget/cancellation interrupts execution. Those two cases assert the captured
   before-local boundary and unchanged actual parent entry exported map in its
   `finally`, with the exact original cancellation reason identity. Public APIs
   do not expose interrupted interpreter-local storage: this is NOT a claim of
   an after-cancellation local-value read. Settled executions assert both local
   values and exact export maps before and after in the same invocation.

   Entry registers synchronous cooperative cleanup before child admission and
   shares its idempotent completion from finally. Exactly one completion is
   asserted before settlement; plugin disposal remains required. No rescue
   abort/dispose is used to turn incomplete work into a pass. Strict Node
   unhandled-rejection mode remains active for all product processes.
3. Original `forward -> sink` still omits `replaceEnv`. The original three input
   executions now assert exact forward `{KEEP:"value"}` and documented sink
   `{KEEP:"value",PWD:"/packed"}`. Exact bytes/origin, no SECRET/PUBLIC export,
   one call per command, status/stderr and disposal remain strong.

   Separate controls execute the same env/forward/sink pipeline for each of
   implicit empty, explicit empty and binary stdin under four policies:
   omitted/default merge; explicit false + EXTRA; explicit true + ONLY;
   explicit true with omitted environment (empty). These12 assertion-bearing
   executions have their own denominator. Positive replacement checks require
   the exact supplied/empty map; negative leakage checks reject KEEP/PWD/PUBLIC
   at the explicit replacement boundary. No policy is silently added to the
   original forwarding path.

## Frozen profile accounting

The48 original hidden IDs execute under BOTH whole captured profiles, separately:
GNU env9.7 Darwin with Bash5.3 primary and Apple env with Bash3.2 historical.
Their actual recorded inputs (including profile-specific cwd/environment) and
all native expected status/bytes/effects remain immutable. This is96 executions,
not96 distinct hidden fixtures. All42 command rows, including actual invalid
grammar, and all6 protocol rows execute in each profile. The6 protocol results
(five known primary losses and one plain control) receive NO supported env-S
core credit. No per-case profile switch or diagnostic normalization occurs.

Primary core accounting keeps39/42 strict-native command matches separate from
three exact virtual-dispatch diagnostic profile checks. Those three checks are
additional declarations frozen from existing observed tuples, NOT new native
goldens; their original strict-native comparisons must remain false. Historical
results are computed without imposing primary numbers or hiding differences.

All10 original packed native rows execute once against both entire immutable
GNU env9.7 captures (Bash5.3 primary/Bash3.2 historical). Seven supported core
rows and three unsupported shebang rows are reported separately. The old
non-S policy tuple is preserved in copied cases but never counted as native
success or shebang completion. Five original consumer host executions, seven
hidden hosts and12 additional policy controls have separate assertion counts.
Here “assertion counts” means assertion-bearing case/execution groups, not the
number of calls to Node's assert library. No rows are skipped or expected-failed.

## Genuine package and source proof

The runner rearchives all213 src files and all7 root files from the exact Git
candidate, rechecks the old full tree inventory, archive bytes, Git blobs and
all220 source hashes. It rebuilds that unchanged archive with authenticated
Node22.22.2 and TypeScript5.9.3, checks all343 actual compiler inputs and every
emitted file against the historical build. Development modules are linked ONLY
for the build and removed before execution. No live source overlay is possible.

The original genuine npm tgz (SHA256
`3ac9f899fbabb14e0473a9345113642fbfd2d12ac6e957659695b6b9e2fbac8c`) is reused,
not repacked. It is decoded losslessly, checked by size/SHA256/SHA1/SHA512, audited
for safe tar entries and matched to all710 original package files and fresh
emitted/source hashes. Offline npm installs it into a fresh external consumer,
which is physically renamed before use. The old install path must be absent;
the moved package must be a real directory and the only installed package.
Manifest bytes and zero runtime/optional/peer/bundled dependencies are checked.

Every plain Node product process uses bare public imports resolved via the
actual moved manifest. All loaded file URLs must be installed dist JavaScript
and hashes must match the original tgz. All710 installed hashes are checked
before/after every process. Product host process and fetch hooks deny/record
attempts; they are guards, not a sandbox for arbitrary trusted JavaScript.

The positive type probe uses the moved package's real public declarations,
including the corrected empty ByteSource. A separate negative compile requires
exactly one TS2741 missing-async-iterator diagnostic for the original raw-byte
binding. No aliases or declaration stubs are eligible. This is a scoped typed
consumer check, not a global source/test gate.

Immutable native captures are sufficient; no fresh native execution is needed.
All child stdout/stderr/status and import observations are retained. Known child
handles have an8-second product watchdog (30 seconds for build/install/types).
Any timeout, overflow, signal, surviving group or watchdog intervention fails
the run, never rescues it into passing. All scratch is removed naturally after
settled children. Unexpected source/primary-tuple/fixture assertion failures
stop the author; no new expectations or product patches are authorized.

Run after committing this entire fixture revision:

```sh
/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node tests/shell-stress/env-split-validity/run-v1.mjs /tmp/env-validity-independent-NEW.json
```

The output path must not already exist. The author uses its own named artifact;
ROOT/different reviewer must run an independent attempt. No self-acceptance,
runtime/shebang completion, superiority, global gate or72-hour claim is made.
