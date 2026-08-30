# Owned-output prototype surface: frozen preparation

Status: **PREPARED, NOT RELEASED, NOT EXECUTED**. Reviewer thread
`01a04292-5421-7363-8bcb-a70b97fae4e9` is independent of the prototype author
and provenance preparer. This directory owns no product or private-source edits.

The frozen cohort has **eight unconditional cases and one conditional finite
authority probe**. There are zero guest cases run, zero engine imports, zero
product runtime imports, zero builds, and zero installs in this preparation.
No runtime verdict or non-leak claim follows from the static check.

## Inputs and authority

- `PINS.json` binds the full prepared candidate, actual copied public package,
  relevant source/declaration/runtime files, copied engine, and existing tools.
- `CASES.json` and `probes/*.guest.txt` freeze exact inputs and field-level
  criteria; `FREEZE.json` authenticates the preparation files.
- `RUNNER-PLAN.md` specifies the legitimate host adapter, positive premise,
  budgets, isolated children, import auditing, and release prerequisites.
- `verify-prepared.mjs` only reads/hashes files and queries immutable public Git
  objects. It never imports product, engine, tooling, or guest code. Its captured
  output is `static-check.json`; the command is:

  `node tests/integration/safejs-owned-output-prototype-review/surface/verify-prepared.mjs`

The preparer seal is `f666ad8c76ea4362b093ee52e3e7e3b5c3702916`.
Q1 `e57b5aa16f749b6fac558877dff0712e64df05a8` is evidence, not a clean
production code commit. The base includes three accepted historical dirty
files. The Q candidate archive is prototype-only. Original receipt retrieval
at `/tmp/safe-bash-owned-output-provenance-handoff-result.txt` is **not**
independent receipt authentication or permission to run. ROOT awaits a different
receipt verifier; this review does not substitute for that verification.

## Actual API and limits

`ByteSink.ownedOutput` optionally contains `consumerClosed: AbortSignal` and
`write(Uint8Array): Promise<void>`. That `write` is the accounted path; there
is no `accountedWrite` field or `runtimeOwnedOutput` object. The TEMP public
`createOutputOperation(context, destination)` returns `signal`, `output`,
`registerCleanup`, `acquire(start, release)`, `child(destination)`, and `close`.
Its `output` exposes only `write`. Type names are not guest globals.

The later run uses supported command/stdio/fs facades from
`createSafeJsCommands`, which `safeJsCommands` also installs, and one explicit
`makeSafeJsShellModule` bridge. It does not grant raw contexts, metadata,
operations, cleanup functions, Node capabilities, or host reporter callbacks.
Namespace spread, callable members, and unsupported function spread are distinct
cases. Missing guest descriptor APIs/Reflect are recorded as dialect limits,
not as successful descriptor/prototype membrane tests. Host descriptor inspection
is a separate source/premise observation, not a guest reflection result.

Private-source hook injection, if released, remains qualified as such: not an
installed private package/import acceptance test. Current private identity must
be freshly checked then; this phase reads only existing regular source copies.
Companion lifecycle fixtures/expectations were not read. Prior cleanup surface
`ad7c09e` and sink `1602a5d` scores are not transferred. Historical first-read
prototype 1/5, baseline 0/5, and API-opt-in 5/5 remain separate and unchanged.
Native `abort(undefined)` versus Q1's synthetic signal override remains a
qualification; this cohort makes no native Bash parity claim. Production gate
8670, env-S dispatch, worker/regex suites, and lifecycle flow acceptance are out
of scope.

## Preparation observations and stop

Read-only source discovery tried two nonexistent paths in the prepared engine:
`src/interp/globals/index.ts` (sed exit 1) and `src/interp/members.ts` (rg path
diagnostic). The actual implementations were located in
`src/interp/globals/object-array.ts` and `src/interp/interpreter.ts`. These are
retained lookup mistakes, not guest/parser failures or product results. No
attempted product/engine execution preceded the frozen cohort. The SafeJS skill
was read for context; its CLI dry-run/spawn/install instructions do not apply to
this source-only preparation and were not executed.

ROOT must explicitly release execution after receipt review. Until then there
is no runnable guest orchestration in this directory, no background wait, and
no child/worker to leave running. Any later fixture or harness correction must
preserve its original frozen bytes and failed attempt in a new version, never
silently rewrite this preparation or raise budgets to obtain a pass.
