# Fixed compiled verification cohort

User-authorized leaf ownership: this new directory only. Old audit artifacts and
production are immutable. Import the original `../bounded-matrix/cases.mjs`
unchanged. Four controls first; the two grep repeats validate this compiled
profile, not new unique coverage. Then only original grep/rg nested 16/20/24/28.
Eight new risky attempts maximum (nine including the separate historical 13-byte
probe); first execution watchdog stops that family, larger lengths are skips.

Loader-only change: compile checked-in source bytes from one Git commit, using
installed TypeScript 5.9.3 and existing strict NodeNext build configuration.
`source-bundle.json` contains exact UTF-8 source/package/config bytes; `.build/`
is the sole disposable directory, ignored, fixed, and owned by this cohort.
Only the original sixteen-module closure is compiled, not the global build.
Compiler subprocess has a separate 30-second preparation cap. Generated JS has
no external package imports, loader hooks, tsx service, stripping or transforms
at runtime. Static ESM import/export closure and file hashes are captured, with
the actual compiled entry paths and reachable artifact hashes read by each child.
Builtins and compiler declaration inputs have separate identities. Runtime hashes
are file provenance, not an ESM-loader trace or an atomic filesystem lease.

The child body/selected exec instrumentation and five-event supervisor barrier
are copied from the original; only loading, hash proofs, and durable scheduling
change. Child retains fixed original flags, clean LANG=C/LC_ALL=C environment,
one command/native call, 5ms local abort, same-invocation Promise.race, 1024-byte
caps, five 128-byte IPC tuples. Parent is capped at 4096 output bytes. Startup
is 1000ms; watchdog is 200ms after ready with no extension. Only exact child
handle SIGKILL; wait for exit, disconnect, both streams close and child close.
Memory flags are heap/stack settings, not RSS isolation; timers are not realtime.
No native grep/ripgrep oracle is invoked. Parent never executes the risky regex.

Before probes: run `node tests/stress/regex-execution/compiled-matrix/prepare.mjs`,
then atomically commit scripts, source bundle, compiler record and frozen manifest.
Local Node version/help and installed package metadata validate the loader choice;
prior documentation retrieval failures are not command approval refusals. No web.

Run each original ID once, in original order, saving its exact JSON automatically:

```sh
env -i LANG=C LC_ALL=C /Users/kjopek/.nvm/versions/node/v22.22.2/bin/node --unhandled-rejections=strict --max-old-space-size=64 --max-semi-space-size=1 --stack-size=512 tests/stress/regex-execution/compiled-matrix/run.mjs grep-linear-match
```

Replace only the final ID with the next declared ID. Claims prevent repeats even
if an attempt fails before evidence publication. All four expected controls must
pass before risk; a setup/harness failure is preserved and stops scheduling.
After a family watchdog, later family IDs record skips without spawning. This
is procedural evidence, not a hostile-host sandbox. Never rerun a selected risky
exec. Live source/doc drift is recorded separately; frozen build drift fails.
No whole-source stability or live-version validation follows from frozen results.

After twelve rows, run `node tests/stress/regex-execution/compiled-matrix/finish.mjs`,
then `node tests/stress/regex-execution/compiled-matrix/cleanup.mjs`. Cleanup accepts
only the known owned directory and recorded completed cohort; no PID searching.
Commit raw JSON, claims, proofs, ledger, and report separately from the freeze.
For provenance-only reconstruction after cleanup, `node
tests/stress/regex-execution/compiled-matrix/prepare.mjs rebuild` compiles the same
bundle with the same installed compiler and checks identical build/type hashes;
it does not authorize any reruns. Existing claims/evidence remain immutable.

All previous cohorts remain distinct, including historical 2/4 matrix controls,
rg setup failure and all eight risky skips; earlier static zero, initial 1/2,
corrected 2/2 harness controls and the single 13-byte grep probe remain separate.
