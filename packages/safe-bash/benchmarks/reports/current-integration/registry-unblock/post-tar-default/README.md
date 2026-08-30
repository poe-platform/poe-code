# Post-tar default registry — separate 53-command checkpoint

## Result and scope

**Requested frozen53 gate: 97/99 pass; two downstream failures remain.**
Exact selection is **79 adapter workflows + 20 others (8 diagnostics + 6 fresh jq
+ 6 split jq)**, not 79+19. All 99 original file/name identities and four test-file
hashes match accepted historical accounting. No tests or expectations were edited,
removed, renamed, skipped or weakened. No full suite, comparator, tar semantic
tests or additional jq breadth ran. Evidence is ready for independent review;
**no staging/commit and no claim of reviewer acceptance**.

The user-authorized53 source was current when originally captured. Live integration
subsequently advanced to **56 defaults**. That later candidate was rejected before
execution, not silently treated as53 or accepted by deriving names from runtime.
This report validates the sealed53 input below, **not the later live56 tree**.

| Final refined cohort | Unique | Pass | Fail | Skip / TODO / cancelled | Exit |
| --- | ---: | ---: | ---: | --- | ---: |
| Matrix | 79 | 77 | 2 | 0 / 0 / 0 | 1 |
| Diagnostics | 8 | 8 | 0 | 0 / 0 / 0 | 0 |
| Fresh jq interop | 6 | 6 | 0 | 0 / 0 / 0 | 0 |
| Split jq interop | 6 | 6 | 0 | 0 / 0 / 0 | 0 |
| **Exact historical identities** | **99** | **97** | **2** | **0 / 0 / 0** | **not green** |

Backend pass/total: memory15/15, real14/14, S3mock13/14, loopbackWebDAV13/14,
mount15/15, overlay15/15, readonly12/12. **Zero preflight failures**; all99 reach
their real callbacks. Passing unchanged callbacks retain actual command execution,
dispatch, status/bytes/namespace, cancellation, output limits and stdin assertions.
Eight decoded diagnostic callback records retain typed FS and namespace evidence.
The two failures have callback stacks at unchanged matrix source line105.

## Source provenance and guarded refinement

Original live capture: **2026-08-27T00:50:00.056Z**, source anchor
**DIRTY `2cacd04614baaa6e95f8663b73ded023eafd2c19`**.
Initial selection: 1,322 regular files, 28 untracked, 915 exclusions;
SHA-256 `db607f2ccabd1e75afb9441d358e19c3b5a350a500dddc82bddd4c3a58b91abc`.
Live-before/live-after inventory, HEAD and full dirty paths matched at capture.
Initial source and test executions are retained verbatim in `selection-attempt1/`.
That selection also produced97/99 and passing controls/build/types, but included
four irrelevant generated JSON reports. Its catalog had stale unused provenance/
mutation metadata even though its actual names, count, runtime assertions and
53/54 mutation checks were already correct. Neither issue is hidden or erased.

A subsequent current-source recapture passed its moving-file check, then failed
the accepted handoff byte guard on `src/index.ts`. The contemporaneous delta added
table-text aggregate wiring and a literal56 registry fixture. No test/build/probe
ran on that rejected candidate; see `rejected-live56/HANDOFF-GUARD.md`. Its guard
failure is not an extra product-test failure and does not enter99 accounting.

At **2026-08-27T00:53:37.322Z**, a new regular-copy refinement used only the already
sealed, authorized53 source from this task. It omitted `legacy-current.json`,
`preparation-type-evidence.json`, `ready-wait.json`, and
`invocation-closure-read-checkpoint.json`; none is in the executed static closure.
Their exact prior hashes remain in `execution/sealed-input.json` under refinement.
No executable source, historical test, expectation or native-reference bytes changed.
The old literal52 catalog remains untouched; the new catalog is independently that
literal list **plus `tar`**, with corrected unused metadata and exactly the same
53 oracle names as the initial post-tar run. No runtime-derived expectation.

**Final refined selection: 1,318 regular files, 24 untracked, 919 exclusions**.
Selected SHA-256:
`6f48f07309b050af2b7581f2c035973a3a4375f62a01fde508acae8868ccdccc`.
Product `src/` SHA-256, identical in both post-tar selections:
`06069adee39d4b3b9c837a80e9f74e35d75ca1ba7f42d0f238f257e628596e78`.

Handoff `4a737f9` is an ancestor of the captured HEAD; frozen `src/index.ts`,
`src/plugins/index.ts`, `package.json`, and literal53 registry fixture match its
exact committed bytes. Fixture/helper/author-controls match `98498c1`; metadata
registry fixture matches `7d0fe7b`. These are per-file handoff matches, **not** a
claim the entire audited dirty source was committed. Four supporting expectation/
data files also match the historical retained snapshot byte-for-byte.

Snapshots reject source symlinks/hardlinks and use independent regular copies.
Initial captured inputs remain unchanged before/after refinement. Final baseline
and mutation source hashes remain unchanged after every phase. Later live changes
to compareEntry/backends, metadata, shell, jq, archive fixtures and registry wiring
are separately recorded, not merged into the tested source. Full dirty paths and
selected source hashes are in sealed/final-verification JSON; excluded report/debris
paths are inventories, not promises their excluded bytes were frozen.

## Nonadditive controls and commands

All following controls pass with zero skips/TODOs/cancellations/signals/timeouts:

- Standalone independently literal53 factory/installed-registry probe: exit0.
- Two selected author registry tests: **2/2**, not Curie's entire claimed20 cohort.
- Existing author capability controls independently rerun: **30/30**.
- Missing-command controls: **154/154**, exactly22 literal commands ×7backends.
  Each removes the named command and inserts an unrelated executable substitute,
  preserving **53** names. Every case sees the exact named missing-family/command
  assertion before callback entry. Sensitivity cannot be explained by total count.
- Optional addition: **7/7**, cardinality **54**, actual callbacks and optional
  command execution. Each backend executes `cat`, find→xargs→rg→sed→awk→jq→jq,
  gzip roundtrip and diff, retaining exact outputs and dispatch assertions.
- Independent literal22 requirement-list contract: **1/1**. Independent TAP
  cohort is **162 =154+7+1**, never added to99. Tar is inventory-only here.

The literal22 names remain `cat cp find mkdir mv printf pwd rm rmdir sort tee test
touch xargs sed awk jq rg sha256sum gzip diff patch`. Mutation source is a separate
regular copy; the verifier injects registry plugins without patching any product
or existing test file. Actual substitutions, counts, named errors and callback
flags are recorded in raw TAP and `execution/accounting.json`. No malformed-
definition mutation or tar semantic parity is claimed.

Exact argv/cwd, complete anchored historical-name regexes and per-phase environment
are in `execution/sealed-input.json` and `*.environment.json`. The four cohort
commands use `node --unhandled-rejections=strict --import tsx --test
--test-concurrency=1 --test-reporter=tap --test-name-pattern=<exact names> <file>`.
Only the two named registry cases are selected in their files; all other registry/
tar cases are omitted, not counted as skips. Author30 and independent162 run their
complete control files. Exact unique identities reconcile with TAP footer counts.

Final scoped typecheck passes, exit0, **1.186s**:
`node node_modules/typescript/bin/tsc --noEmit -p audit/scoped-tsconfig.json`.
Actual root build passes, exit0, **1.746s**: `npm run build`, whose frozen script is
`tsc -p tsconfig.build.json`. These are not full `npm run typecheck`/`npm test`.
All frozen full package script strings are recorded without implying they all ran.

The reproducible runner is `execute.py`: `freeze`, `run`, `supplement`, and an
explicit `refine` action for the documented retained53 selection. It reuses the
hashed earlier executor's bounded spawn/cleanup implementation, not its old run
function with old output paths. Every output path is rebound to this new phase.
Do not rerun over these artifacts; the executor refuses existing result paths.
The **same original900-second deadline** covers initial and refined executions;
it was not reset. Final build ended227.423s after original capture. All phases
completed normally apart from the expected matrix exit1; no signals or timeouts.

## Dependencies, isolation and preservation

Node **v22.22.2**. Root lock hash remains
`9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`.
The manifest legitimately adds the tar export; dependency/workspace declarations
still match the old locked manifest and installed versions. **314 regular installed
dependency files** were hash-verified and privately copied, with four internal
relative `.bin` links only. Versions/resolved/integrity metadata match the lock.
Original and reused-copy hashes remain unchanged. No installs, external network,
workspace aliases or private repo reads; installed packages were not independently
re-extracted from npm tarballs. Platform optional-package limitations remain.
No pinned just-bash comparison or dependency was used.

Per-phase HOME/TMPDIR/XDG/npm caches and build output are private. Captures are
**contemporaneous immediately before spawn**, not backfilled. Retained paths:

- `/tmp/safe-bash-registry-post-tar-nuzewj1c`: initial53 source and mutation copies.
- `/tmp/safe-bash-registry-post-tar-refined-ujuf3ja1`: final source and mutation
  copies, aux verifier inputs, isolated caches, and generated baseline `dist/`.
- `/tmp/safe-bash-registry-post-tar-ztx4patg/source-attempt-1`: rejected56 candidate,
  never executed. macOS `/private/tmp` resolution is not a live-checkout alias.

All six retained baseline/mutation snapshots across historical52, initial53 and
refined53 were checked unchanged. No own child process groups or fixture debris
remain; only documented snapshots/caches/build artifacts are retained. Static
review of executed entrypoints and conservative import/export closure finds no
live-root source alias; mutation closure is checked separately. **No universal
computed-import/no-alias claim**: unexecuted first-read-independent.snapshot.mjs
and first-read-guard.snapshot.mjs retain known live-root aliases and are excluded.

Parent52 phase's **60 manifest entries**, its manifest bytes, catalog and raw logs
remain unchanged. Its DIRTY5076b32/d779b4b516275895…97/99 result stays historical.
Accepted96db59ac parent report's94 manifest entries remain unchanged, anchored to
DIRTY57d9d986/5905112264b83a5e…, not committed-source validation. Historical initial
environment remains inferred/reconstructed. Raw initial53 artifacts were moved
intact to `selection-attempt1/`; literal path strings in them preserve original
capture locations. Repeats do not enlarge the99 denominator.

## Remaining failures and review handoff

Poincare: exact failing names remain `s3: create, copy, append, inspect and remove
files` and `webdav: create, copy, append, inspect and remove files`. After successful
mkdir/copy/append/read/find assertions, unchanged matrix line105 runs
`rm scratch/nested/copy.txt && rmdir scratch/nested && rmdir scratch && test ! -e scratch`.
Raw `execution/matrix79.stdout:159` and `execution/matrix79.stdout:246` show ENOTSUP:
S3 cannot atomically require an empty directory prefix; portable WebDAV has no safe
rmdir equivalent. Frozen source refs are `src/fs/s3/filesystem.ts:509` and
`src/fs/webdav/webdav.ts:480`. Keep safe-empty-directory gaps open; no skip or
unsafe recursive fallback is authorized. This audit fixes no source bug.

The **42 historical jq differences remain OPEN**, separate from12interop cases;
no credit is taken for later jq fixes. S3 is mocked, WebDAV loopback, native
expectations frozen reference JSON rather than fresh live-native execution.
No real-provider, full-shell, tar compatibility or superiority claim follows.
Curie's20/20 and separate tar365pass/111fail claims are attributed only in
`LEDGER.md`, never folded into these measured counts.

Read the prior final static reviewer detail: it accepts the older capability/
registry handoff design but has not reviewed these post-tar execution artifacts.
Keep parent README/ledger and all prior evidence unchanged pending review. Root
should resume the reviewer on this phase, including the generated-input refinement
and rejected live56 capture. **No commit yet.** Current56/table-text integration
requires separate authorization and frozen validation; this phase does not cover it.
