# First candidate: holdouts pass; queued-plugin disposal regression found

**The frozen H01–H22 cohort passes 22/22 unchanged.** Broader independent review
is **not an unconditional acceptance**: the separate post-run disposal review
confirms R1 below. No failed result is hidden by the 22/22 count. ROOT must route
R1 to the sole shell source owner; this verifier makes no source fix or policy
waiver.

## Exact first execution

- Candidate snapshot: `4c16d9c5a0e8661bc326a754205559a3e7ea6a32`.
- Contract ancestor/content: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- Arch callback ancestor/content: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- All ten preparation files match
  `0f4339d90937c6a82db9fd84b99a5b5ca9f30974` byte-for-byte. No candidate source,
  author tests, fixtures or evidence was inspected until the full unchanged run
  had completed. Initial inspection used Git hashes/ancestry only.
- The exact candidate already contains the contract and callback changes. No later
  snapshot selection or live overlay was needed. Its original package, lockfile,
  root exports and tsconfigs match the callback commit's corresponding files.

One full committed-source archive build succeeds, status 0, with empty build
stdout/stderr. All **205 source/config identities**, **668 emitted identities**
and copied frozen helper hashes remain unchanged. Each of 22 separate child
executions imports the actual archived public `dist/index.js`; all **3,520 actual
main-thread load records** pass the canonical archive/source-hash guard. All
22 child statuses are 0, none is signaled, no case is unexecuted, and no late
unhandled rejection is recorded. There are no retries or amended assertions.

This denominator contains 21 compound public-Shell cases and one direct optional
host control, not 22 native-worker cases. Exact byte/sink assertions, existing
error-to-status behavior, undefined/falsy failure handling, gated cleanup barriers,
opaque nonjoins, nested closed admission, local lease isolation, budget/provenance
and errexit checks all pass as frozen. H09/H17 still disclose that dispose-only
exec outcome selection is not prescribed by the contract; the measured execs
reject, while their required cleanup barrier assertions pass. No unwritten error
class or status is added to those assertions.

Raw proof: acceptance-first.json. Scratch receipt: acceptance-first-scratch.json.
The archive was removed only after durable proof, without following its tooling
symlink. This run does not replay Arch's compiled/packed real-worker cases, the
old three-case investigation, or the five custom first-read requirements.

## R1: immediate disposal disrupts already-queued plugin setup

After the unchanged run, inspection found the old and new setup-rejection catches
are the same: old `shell.ts:140` and candidate `shell.ts:183` both await
`this.#ready.catch(() => undefined)`. **The catch itself is not a new regression.**
Actual old/new public API controls establish the narrower timing regression:

```js
let ownedLease = false;
const shell = new Shell({ fs: new MemoryFileSystem() });
shell.use({
  name: 'queued-middleware-plugin',
  setup(host) {
    ownedLease = true;
    host.use((_context, next) => next());
  },
  dispose() { ownedLease = false; },
});
await shell.dispose();
```

| Supplementary control | Old `07acb1a` | Candidate `4c16d9c` |
| --- | --- | --- |
| D1: explicit setup rejection after one successful plugin | Exec rejects with exact setup Error; disposal resolves and disposes the successful plugin | Identical |
| D2: queued middleware plugin, immediate dispose | `setup-start`, `middleware-installed`, `plugin-dispose`; disposal resolves; ownedLease=false | Only `setup-start`; disposal resolves; ownedLease=true |
| D3: completed setup, one disposal callback throws | Empty exec bytes/status 0; reverse-order disposal drains both callbacks; AggregateError contains the one exact failure | Identical |

These are **three separate compatibility comparisons: two agree, D2 differs**.
They are not added to the 22-case denominator. Capture subprocess status 0 means
the observational capture completed, not that D2 passed compatibility. The owned
lease is an explicit small host resource marker: this demonstrates a skipped
plugin disposal callback, **not a newly measured native Worker leak**.

Source chain at the exact candidate:

1. `shell.ts:169` now sets `#disposed = true` before the queued setup chain runs;
   the old method waited for readiness before setting that flag.
2. Accepted plugin setup runs at `shell.ts:39`, acquires its fixture-owned lease,
   then calls the valid PluginHost.use middleware API.
3. `Shell.use` rejects the setup's host call at `shell.ts:34` because the shell is
   already marked disposed. This attribution follows the inspected source; the
   setup failure is not exposed by the public disposal result.
4. `#plugins.push` at `shell.ts:40` is bypassed by the rejected setup. The unchanged
   readiness catch at `:183` absorbs the setup rejection, so the plugin never
   appears in the disposal loop at `:185` and its cleanup is skipped.

The supplementary fixture was authored after source review and run once per full
committed profile. It uses actual public root TypeScript imports through the
existing tsx development tool, **not another compiled holdout run**. Full source
archives contain 196 old and 205 candidate source/config files; respectively
156/157 product import records match Git-backed files. All file-import, source,
helper and public-index guards pass. The profiles include other committed source
changes; this is not a claim that the whole repositories differ only in disposal.
The control exercises only the identified Shell/plugin path. Both archive children
exit naturally; the only subprocess stderr is Node's loader warning. Each archive
is removed after raw proof without symlink traversal. No host rescue or rerun.

Raw proof and executable reproduction: setup-disposal-review.json,
setup-disposal-control.mjs, setup-disposal-review.mjs. Cleanup receipt:
setup-disposal-scratch.json.

**Ownership recommendation, not a patch:** preserve synchronous rejection of new
public exec/admission during disposal, but reconcile that with completion/disposal
of setup already accepted before disposal. Do not simply move the disposed flag
back after readiness and reopen admission races. A private distinction between
new external admission and already-admitted setup is for the source owner/ROOT to
choose; no new public API or failure waiver is proposed here.

## Independent lifecycle source review

At the frozen candidate, cleanup.ts:20 checks caller reason before closed/parent
admission; child scopes link before user work at :26. Registration validates
callability and retains duplicate registrations at :33. Close memoizes its promise,
seals descendants synchronously, and starts all eligible callbacks/children using
Promise.all; callback failures are individually caught and retained at :46–54.
The cleanup-only selector preserves a sole undefined rejection and aggregates
multiple failures at :62. It does not invent a callback-order guarantee.

Runtime dispatch creates its child scope before exposing the context or executing
middleware at runtime.ts:788; the same scoped registration closure is exposed
before middleware entry at :804. Invoke creates its child before input construction
at :1328, so closed admission precedes iterator/FS work. The private symbol travels
with internal IO, while command-visible context omits it. The added command-signal
distinction avoids treating normal private scope closure as caller abort. These
paths are exercised by the nested/late-admission and early-pipe holdouts, not by
new broad shell syntax tests.

Public exec tracks its active scope at shell.ts:68–73 and drains outside the
execution race at :79–82. It selects the caller's exact reason after drain, then
the selected execution rejection, then cleanup failures at :83–85. The explicit
failed flag preserves falsy/undefined failures. Registered cleanup failures do not
flow through the existing generic command error-to-status conversion. The private
execute input-close catch preserves an earlier execution failure at :155–156.

Disposal closes new admission synchronously, snapshots active invocations, shares
one disposal promise, closes each scope and aborts its own budget at :167–178.
It awaits registered drains rather than active handler promises at :181–190.
That supports the cooperative opaque-handler controls, but it also creates R1's
already-queued setup interaction. It still awaits plugin readiness, as before;
there is no new guarantee against an uncooperative plugin setup promise.

Arch's callbacks are present with exact committed hashes. Real worker ownership
acceptance remains Arch's separate independent task; inspecting registration and
session-close code here is not a replacement for those runs.

## Limits and handoff

No product/source/contract edits, frozen-test amendments, runtime dependencies,
global typecheck, broad suite, native Bash oracle, packed duplicate, kernel/OLD9
or first-read replay. The six foreign TS2304 artifacts are untouched. Mutation
executions were not added after finding R1; the original mutation criteria remain
design criteria, not claimed measured mutation coverage. No universal cleanup,
all-host-work preemption, deployed-provider or native parity claim is made.

All scope-owned proof and original frozen files remain durable. All started
children are finished and all three owned archives are removed. ROOT should retain
the scoped 22/22 result while routing R1 before any broader lifecycle acceptance.
