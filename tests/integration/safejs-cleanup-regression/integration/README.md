# Independent actual SafeJS → Shell cleanup integration

**Bounded review, August 27, 2026. Final capture: 18/19 assertions pass, one
original reviewer assertion remains red. No new production cleanup defect was
demonstrated. This is not an all-green gate or whole-SafeJS acceptance.**

The failing assertion asks for a raw stdout-sink Error rejection through `grep`.
The pinned utility catches that ordinary error, emits its diagnostic, and returns
status 2. The failure, exact guest, argv, result, and original assertion are kept;
it is not relabeled a pass. A separate precise status/diagnostic control passes.
Root owns routing this finding. No production fix or new API is proposed.

## Frozen boundary

- Entire public commit: `f44958bf48778737a58535e2bc9b37c292ac28c4`.
- Private read-only HEAD: `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`.
- Full public archive: **15,798 regular files**, every extracted blob checked
  against its committed Git blob ID; no selective source overlay.
- Archive SHA-256:
  `d942398b277a621b82b98dbaab267291ac4dc7b613f884b617650357964989bd`.
- Installed `virtual-bash` tarball SHA-256, identical in all eight captures:
  `1a757856aff57daa1fd3e5c40f4e011b1bb1ec43877f2fd5c8b6fae7f8e3ff5e`.
- **216 source/config hashes** include every `src` file, root barrel,
  `package.json`, lockfile, and both TS configs. Live source/config matched the
  pin before and after every capture, despite unrelated public HEAD movement.
- Product inputs are committed, not a dirty overlay. The newly authored harness
  was uncommitted during capture; exact hash-checked source snapshots are retained
  and committed with this review. Historical product proofs do not certify it.
- Current private source is copied as **264 unchanged regular files**; **63
  distinct private files** are loaded in the final cohort. Four injected hooks
  come from `src/run.ts`, `src/interp/budget.ts`, `src/modules/fs.ts`, and
  `src/interp/host-bridge.ts`. The complete per-file hashes are in the evidence.

The pin includes contract `07acb1a`, pre-acquisition regex registration
`01aa1bf`, runtime drain `4c16d9c`, and setup-admission follow-up `1b133a8`.
The private commit is resolved in the private repository, not assumed to exist
in public Git. Root package exports/configuration are unmodified.

## What actually runs

Every enabled guest runs the current copied interpreter in a strict child,
through the packed public `safeJsCommands` plugin. The host injects the genuine
`run`, `Budget`, `makeFsModule`, and `declareHostOperation` implementations.
No stub interpreter, private package installation, engine build, upstream patch,
or product-internal import supplies acceptance.

Two explicit host integrations are measured:

1. A declared `companion.search` host callback dispatches literal guest argv
   through the current public `CommandContext.invoke`. The actual public Shell
   registry contains `grep` and `rg`; middleware, VFS, inherited streams, signal,
   and shared Shell budget remain in that invocation path.
2. Public `makeSafeJsShellModule` calls an owned public Shell containing those
   registered utilities. Host middleware synchronously registers cooperative
   cleanup **before** creating/admitting that nested Shell. Its same idempotent
   cleanup is also awaited from `finally`, and closes admission before disposal.

The host middleware/callbacks are trusted fixture code, not new guest privilege
or default plugin functionality. The bridge's signal race does not by itself
promise a public cleanup barrier; the explicit nested-Shell owner supplies the
registered cooperative cleanup required by the integration contract.

## Final cases

`evidence/attempt-08/report.json` is the final frozen capture.

| Checks | Count | Result |
| --- | ---: | --- |
| Literal registered grep/rg success and early downstream close | 4 | 4 pass |
| Literal caller abort, dispose, overlapping abort/dispose | 4 | 4 pass |
| Guest step budget, guest error, retained capability lifetime | 3 | 3 pass |
| Original raw sink-rejection expectation | 1 | **1 retained assertion failure** |
| Separate exact sink status/diagnostic control | 1 | 1 pass |
| Delayed cooperative cleanup with overlapping finally/dispose | 1 | 1 pass |
| Public pre-abort, no runtime/admission | 1 | 1 pass |
| Public bridge success, early close, caller abort, dispose | 4 | 4 pass |

There are 18 actual guest executions and one deliberately non-executing pre-abort
control. Of the 18 accepted assertions, 17 execute guests. Do not count the
pre-abort control or the retained failing assertion as a successful guest run.

For every one of the **18 actual native regex workers**, the child records
registration before creation, real native exit, and fulfillment of the actual
`Worker.terminate()` promise **before public `Shell.exec` settlement**. Relevant
`Shell.dispose` and inner public Shell boundaries are checked too. Error and
frozen-record caller abort reasons are checked by strict identity, not text.
All **19 copied esbuild service subprocesses** close through their owned loader
service handles before the corresponding strict child exits. No rescue is used.

Ordinary native cases have **no added cleanup sleep**. Only the explicit
cooperative-hook case has a 12 ms asynchronous release, and asserts that neither
public exec nor public disposal has settled before that release. Native work is
benign, bounded `^alpha` matching over finite input. The guest budget control uses
a finite 10,000-iteration loop and checks that its second search is not admitted.

## The retained failure

`literal-grep-caller-sink-error` still requires `Shell.exec` to reject with the
exact external stdout sink Error. Instead it returns:

```json
{"exitCode":2,"stdout":"","stderr":"grep: sink:literal-grep-caller-sink-error\n"}
```

At that settlement the native worker has exited, native termination has settled,
and cooperative cleanup is done. Pinned `src/commands/grep.ts:79` catches ordinary
errors and diagnoses them, while preserving cancellation separately. That path
explains the selected utility result; a raw caller abort is not involved. The
reviewer's original raw-rejection premise is unsupported here. No diagnostic
assertion was loosened, no old failure was overwritten, and no product bug is
invented from this fixture mistake. The additional status control asserts the
entire exact stdout/stderr/status result, not a broad pattern.

## Capture history and qualifications

| Capture | Assertion capture | Qualification |
| --- | --- | --- |
| 01 | 1/1 | Supported success first; initial observer |
| 02 | 16/17 | Original full cohort; raw sink expectation fails |
| 03 | 18/19 | Removes ordinary 12 ms delay; adds two explicit controls |
| 04 | No guest cases reached | Loader-audit preload error: null CommonJS source |
| 05 | No guest case reached | Loader-audit `resolveSync` instrumentation error |
| 06 | No guest case reached | Loader CommonJS `require` instrumentation error |
| 07 | 1/1 | Fully guarded loader/native child smoke, service child closes |
| 08 | 18/19 | Final same-byte harness as 07; original sink assertion still red |

Capture 04's original reporter says `behavioral-failures`; its 19 children fail
during preload, without case result files, so these are infrastructure failures,
**not 19 product failures**. Original stderr and the original reporter output are
preserved. Captures 05 and 06 each select only the success smoke. No engine or
product source changes are involved in these loader repairs.

Original public harness bytes for 01/02 are in `evidence/original-harness`.
Later captures store their exact `.fixture` source snapshots. These are evidence
data, not canonical test discovery or a second test suite. Original case inputs,
failures, and hashes remain beside corrections. No sibling `surface` cases were
read, and the independent generic architecture cohorts were not rerun or copied.

The measured capture interval is **09:43:35–09:55:29 UTC**. Individual command and
capture times are recorded; this is not a 72-hour work claim. Loader-debug runs,
overlapping repetitions, and pre-abort controls are not extra capability passes.

## Isolation and process proof

The runner uses Node **22.22.2** on Darwin arm64. It builds only the full public
archive in an owned temporary tree, packs offline, and installs that tarball into
a separate regular-file consumer. Dependencies remain empty. Existing public
cached TS 5.9.3/tsx 4.23.12/esbuild 0.28.2 and type tooling are copied unchanged;
no dependency is added or downloaded. Private sources are loaded, not built.
The unchanged public build emits declarations; no new standalone private-engine
or whole-product test/typecheck claim is made.

Plain Node imports verify the root public APIs without a TS loader, and deny live
private source, archived product source, live checkout dist, and unexported
product-internal subpaths. Final ESM, CommonJS, loader-thread, and real native
worker loads are audited against a regular-file inventory. **9,866 load-record
hashes** are verified. The Node loader worker has its own asynchronous audit;
CommonJS resolution and the copied esbuild executable are checked too. Audit
preloads added to real regex workers are observation only, not replacement workers
or injected worker results. The harness changes observer startup timing, so no
performance or uninstrumented-worker equivalence claim follows.

Every actual-engine child has strict unhandled-rejection mode, a 256 MiB heap
limit, a 9-second containment watchdog, and a 13-second parent deadline. The
product regex startup/request limits are 2.5/1.5 seconds; the guest command has a
6.5-second limit. Watchdogs affect known owned handles only and make acceptance
fail. All final parent-observed child exits are natural, with no signals/timeouts.
Native ownership assertions occur before any failure rescue or tooling shutdown.

Private queries use `GIT_OPTIONAL_LOCKS=0`. All eight captures preserve identical
private HEAD, index, status, metadata and engine file hashes before/after; existing
private dirty package/lockfile edits remain untouched. Copied regular files and
cached tool sources are checked again afterward. HOME/TMPDIR/npm configuration
are owned, TSX cache is disabled, and runtime imports cannot fall back to live
private files. Evidence is saved before removing each owned archive/consumer/tool
tree; all eight temporary trees are removed. No foreign processes are killed.

## Reproduce and inspect

From the repository, with a **new** owned evidence directory:

```sh
node tests/integration/safejs-cleanup-regression/integration/run.mjs \
  tests/integration/safejs-cleanup-regression/integration/evidence/NEW_CAPTURE
```

The default run deliberately still exits **1** for the retained raw sink-rejection
assertion. Inspect per-case results rather than advertising an all-green gate.
An optional trailing case ID selects a bounded smoke; it cannot certify the full
cohort. Private access and the already installed cached tools are prerequisites.

Offline evidence consistency verification, without loading the private engine:

```sh
node tests/integration/safejs-cleanup-regression/integration/verify-evidence.mjs
```

That verifier checks archival integrity and preserves the failed assertion; its
success is **not** behavioral acceptance. `VERIFICATION.json` contains its capture.
No broad superiority, all-SafeJS security, generic raw-host cancellation, durable
replay, all backends, native-worker parity, or new global first-read semantics are
claimed. Previously known external raw-engine limitations remain separate and
were not reclassified as new product findings.
