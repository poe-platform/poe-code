# Post-author-release review executor preparation v1

This is executable review preparation after ROOT released runtime-only author work,
not a new PRECODE freeze. There is no routed candidate and no review-execution
authorization. Nothing here changes a frozen expectation or retrospectively changes
the timing of the original independent controls.

## Authority and unchanged denominators

- Original 18-file control seal: `beeda1a96bb25c846cd6df0cf0f7a0fff06bcf6e`.
- Four-file ratification append: `2fbd1e051993cadf384cf4fc559f20e3f0b7cc1c`.
- Normative author policy: `ef833fd2cbf006993b1f94d7f3a0d3254e0ad3de`,
  `tests/shell/cd-prerequisite-20260828/ROOT-RATIFICATION-v3.md`.
  Its blob is `37ecdd0c187896ab7583c3631c4d6fea262f4c29`; SHA-256 is
  `1a88dd6c82a82803bd0c5b1aa2939f394ecb1486626bd074c7a1f6455a8fe60e`.
- Original policy seals remain `7728401ccb7bfa8f1961ffe100ca5617f3a6b553`
  and `882085678862a23cfeef6505fa41a03891743439`.
- Exactly 82 command rows: behavior16, permissions14, adapters6, state9,
  output5, cancellation5, limits27; exactly four diagnostic rows.
- Exactly 10 positive and10 negative public type controls, 12 invariants,
  seven future integration controls. Three layouts do not triple unique coverage.

The old files contain data/static validation and a declaration-only baseline
binder, not an executable product-case runner. This append supplies actual future
fixture and layout code rather than a duplicate cohort. `COVERAGE.json` enumerates
all86 unchanged IDs, all expected-field classifications, call counts, modes,
invariants and future controls. The original `cases-v1.mjs` and both type fixtures
are authenticated and copied unchanged only inside a future authorized run.

## Admission, source and tools

`BINDING.pending.json` and `ROUTE.pending.json` are deliberately unusable templates.
`run.mjs` without a route fails with `CD_REVIEW_ADMISSION_DENIED` before invoking
its actual executor. No product import, source composition, compiler, npm, VFS,
provider or network operation occurs on that path. Merely importing the runner
does not execute it. The exported actual executor repeats admission first.

ROOT must explicitly supply:

1. Full candidate commit and composed-source tree, exact `src/shell/runtime.ts`
   blob and SHA-256, and a full author evidence commit/path/blob/SHA-256.
2. A separate execution route with `authorization: ROOT_EXECUTION_AUTHORIZED`,
   a nonempty ROOT reference, the matching candidate commit, and `bindingSha256`
   equal to SHA-256 of UTF-8 `JSON.stringify(parsedBinding)` without a newline.
   This is a trusted ROOT attestation supplied by the coordinator, not a claim of
   cryptographic signer authentication. No moving HEAD selection is permitted.
3. Modes exactly `source`, `installed`, `moved`; a new explicitly owned output
   directory equal to `authorizedWriteRoot`, below repository `tests/` and outside
   the immutable independent-control directory. No output path is supplied here.
4. A separately pinned tools-manifest path and raw-file SHA-256. Schema1 has
   `roots` with exactly `node`, `typescript`, `npm`, `nodeTypes`, `undiciTypes`.
   Each root has an absolute `source` directory and the complete `inventory`
   format returned by `common.mjs` (including root/directory modes and all regular
   files' modes, sizes and SHA-256). Node/TypeScript/npm also have a relative
   `entrypoint`: the Node executable, `lib/typescript.js`, and npm CLI respectively.
   The same TypeScript directory must contain `tsc.js`. No symlinks, implicit
   installation, downloads, ambient NODE_OPTIONS or ambient credentials qualify.

Actual execution, only after that separate route, uses:

```
node tests/shell/cd-prerequisite-independent-20260828/executor-preparation-v1/run.mjs BINDING.json ROOT-ROUTE.json
```

The fixed base is `5137a74ec855a32d8a8860eb66b62eb44d11e290` plus only
`src/fs/webdav/webdav.ts` and `src/fs/webdav/README.md` from
`ca1d33424b94a21ae0f40a36412fd8191611e2df`, yielding full Git tree
`7c68831a81fc49c94ad9177e58ca9fd7d0aca352`, independently accepted through
`2ec9bcdafce7964769e87ed6fe681ea0936f266a`.
`workspace.mjs` recomputes that full tree without writing Git objects, then the
tree with only the routed runtime blob changed. It materializes the same exact265
build-input files as the accepted provider workflow; it does not take unrelated
candidate-commit files or overlay live source. Complete build output, installed
package, source input, tools and consumer inventories are retained with additions.

## Actual future orchestration

`run.mjs` copies regular pinned tools, builds with the unchanged candidate build
configuration, runs the source public-root consumer, packs with npm offline and
scripts disabled, installs the real tarball in a separate consumer, and runs it.
It then physically renames that consumer, confirms the old location is absent and
the full inventory identical, and runs the same86 and same type fixtures again.
The original source directory is absent for installed/moved runs; retained source
bytes live outside their loader admission lists, not as an available fallback.
No declaration facade, manually substituted package or fabricated moved mode is
used. Each installed file outside `dist` must equal an exact composed-source file;
complete installed `dist` must equal complete emitted `dist`.

`entry.mjs` admits the actual bare `virtual-bash` root, maps source imports only to
authenticated TypeScript, and logs each loaded product/harness module's hash and
source transform hash. Installed/moved modes additionally require Node's actual
bare resolution to match their real package root. All nonbuiltin modules must be
regular files from the exact admitted inventory. TypeScript itself is pinned and
loaded before source hooks, not represented as a product-module load. Global fetch
is denied; WebDAV receives only its owned injected mock transport. The loader is
an identity/fallback guard, not a sandbox for arbitrary hostile host JavaScript.

`types.mjs` runs only in future authorized children, using actual candidate emitted
declarations: source maps to its freshly built public declaration; installed/moved
use the real bare package. Every file read must be admitted and hash-identical;
unadmitted resolution probes return absence, never live-source content. Positive
fixtures must have no diagnostics; negatives must have exactly their ten intended
locations with TS2322/TS2375, not missing imports. Each negative is independently
neutralized in memory to `undefined as never`; exactly the other nine diagnostics
must remain. Original fixtures never change. This is not a new type cohort now.

Four future load-admission negatives per layout reject an outside path, missing
public entry, altered runtime bytes and altered provider bytes. Mutations occur
only in the authorized disposable run, are restored in finally, and the complete
inventory must match afterward. These are load controls, not semantic mutant kills.
The provider source is not executed during these negative checks.

## Fixture ordering, cleanup and observation limits

`fixtures.mjs` uses only the known public Shell, registry, middleware, command
context, Memory/ReadOnly/Mount/WebDAV and FsError APIs. Each case creates owned
virtual state. An ordinal guard admits exact stat then X_OK calls with the runtime
signal, exact faults and paths, and no extra methods; S07 alone admits its explicit
redirection write to `/out`. Actual Memory mode denial, readonly delegation,
mount remapping and injected WebDAV directory/403/file responses are distinct.
Typed native-compatible misses remain ENOENT/ENOTDIR/EACCES only; project EPERM
and ELOOP fatal gaps remain intentional. No adapter mock proves a service or ACL.

Each observation command receives the frozen `$?`, `$PWD`, `$OLDPWD` arguments and
actual context cwd/exported environment. This checks final publication/partial
publication, prefix restoration and no rollback without inventing a persistent
Shell getter. Deferred outputs and cancellation use invocation-owned cleanup,
live caller reasons (including errno-shaped reasons), held promises, copied
captures and disposal settlement. Cleanup closes admission before releasing
resources; cancellation cases hold cleanup and check that exec/dispose have not
settled early. Late rejection listeners and released response-body locks are
checked. A setup exception is a cleanup-unknown failure, not an ordinary case fail.

`series.mjs` awaits each result and cleanup. An ordinary assertion failure remains
a failure and permits the next row only after clean settlement. Cleanup failure,
unknown cleanup, adaptation pending or forced child termination stops continuation.
Children have harness-only bounds: 300,000ms, TERM then KILL after5,000ms,
8,388,608 captured bytes. These are not cd caps or SharedBudget settings. A forced
kill is never natural settlement or a product pass. Each actual child capture is
classified separately from fixture evidence. Fixture results are read only after
natural child exit. No timeout is treated as cooperative cleanup success.

The runner does not have access to private publication/write counters. Exact
internal write order, incremental allocation, work reservations/yield positions,
SharedBudget identity and rejected-exec state remain **candidate-source-review
pending**. In particular L26's unchanged two-command/maxCommands2 input cannot
gain a third observer; its final state requires source review, not a guessed API.
P06's final typed internal error is not serialized by Shell stderr; its exact
diagnostic and typed scripted inputs are observed, internal error selection still
requires review. S07's no-other-namespace-change invariant is not claimed as a
full VFS snapshot measurement. COVERAGE maps these fields explicitly. Public
observations plus pending fields yield `public-pass-design-pending`, never a full
case acceptance. F07 requires a separately authenticated ROOT regression route.
No unseen helper names or new public API keys are assumed. Any later adaptation
must be versioned outside this seal; failures must not be suppressed or weakened.

The orchestrator exits1 on recorded public assertion failures; otherwise it exits2
because source-review/F07 acceptance remains pending. A natural exit0 from a child
does not mean complete independent acceptance. There is no automatic runtime go.

## Limits and evidence qualifications

All frozen numerical inputs remain unchanged: inclusive65536 UTF-8 path/CDPATH,
4096 components,4097 candidates/8194 possible public calls,8388608 private work,
and128-unit yield boundaries. L18 is4098+4097*14=61456 work. L19 is
48824+57*146312=8388608. L20's unconstrained total is8388609: final access is
not admitted. L21 has67956 remaining, insufficient for an80004 reservation.
Diagnostic payload max65792 includes `cd: ` but excludes Shell origin/newline;
prefix<=65780 at complete scalar boundary plus exact12-byte ` [truncated]`.
Tests do not allocate unbounded product diagnostic strings to infer RSS caps;
incremental construction remains source review. Shared budget is never reset and
no per-byte command charge or new public limit key is introduced.

Historical native observations stay at original `317128ddbce8ac9d321870f46957c33bca257612`
and evidence `d0b2557e1cb443b94d595c8a4cdd468f94c2601c`:28 GNU5.3-on-Darwin
observations, not new runtime passes, and D22 is not the sole oracle. Strong checked
OLDPWD stopping before cwd and legacy explicit empty-string=>dot remain intentional
profile differences. Provider acceptance remains virtual traversal/logical cwd,
not deployed-service execution or ACL enforcement. Directory-stack work is separate.

## Checks performed now and provenance

Only synthetic checks, own syntax, frozen metadata/scalar arithmetic and hashes
run during preparation. `SYNTHETIC-RESULTS.json` reports these separately from
source86 NOT RUN, installed86 NOT RUN and moved86 NOT RUN, and future types10+10
NOT RUN in each. No native/provider/product/build/pack/install/type compiler runs.
Fake executor IDs are conspicuously `FAKE-*`; no manufactured candidate SHA exists.

`INPUTS.json` identifies all22 inherited files, consulted pinned old provider
executor utilities and accepted5137 public shell declarations. Previous baseline
implementation exposure recorded in immutable `EXPOSURES-v1.json` is inherited,
not denied; it is not re-inspection of current/unrouted implementation. This turn
does not inspect candidate/current runtime code. Metadata hashes of sealed
historical records are not new execution evidence. Content-address authentication
is not signer attestation. No claim is made about unseen scratch elsewhere.

`verify.mjs` is read-only data validation. It authenticates original18 at beeda,
ratification4 at2fbd, exact old22 live membership excluding ONLY this authorized
append, and exact new membership (manifest self-hash excluded, Git binds it).
It validates committed inputs and selected historical native/provider records,
records unchanged foreign staging and rejects additions/changes in synthetic
inventory negatives. It does not run old auditors, product tests or type compilers.
After commit, invoke it with the full preparation commit as its sole argument.
