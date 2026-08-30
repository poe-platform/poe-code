# Narrow v12 result:284 semantic PASS; overall HOLD

August28,2026, America/Chicago. One controls cohort and one target cohort; no
retry, expectation relaxation, production change or acceptance promotion.

## Commits and scope

- Authorized concise AGENTS commit: `7d1ade5a2573af9c1f75010770c45052207296c7`.
- Initial control preseal: `9502c232f78796aa21587b8c2fcb8f77f3aa90ba`.
- Final control preseal: `dcd207bdeb37590f1db2b4db7e3c68d55cfd57e4`; before controls,
  only bounded outer-close wait/raw-write completion were corrected.
- Conditional target preseal: `c5af63a2f6b9053ccd1d4b7b0fa2e99f4f74175a`.
- Final evidence commit is the commit containing this HANDOFF and EVIDENCE-MANIFEST.

AGENTS changes add exactly the three requested durable concepts. A byte comparison
against the parent version verifies that removing those five added lines restores
all original rules. No instruction snapshot is copied into this evidence.

`SOURCE-DIFF.patch` is the exact run delta. Worker, observer, loader, cases,
fixtures, bootstrap and tool wrapper retain v11 bytes. Changes are only canonical
census checking, outer raw-capture/clock routing and version-local data/type paths.
Original base8437+Git988/full898 package SHA68541722217fb3f88f7317750c8f1a66042ea090f2c769564b9afc14372dfe68
and original d2502aae Shell composition remain. H10 remains ONE unchanged call.

## Actual result and blocker

| Role | Actual result |
|---|---|
| Source / compiled / actual offline installed / physically moved |71/71 PASS each;284/284 total, zero UNRUN |
| Strict build |PASS;896 dist member hashes match the original898 package |
| Offline npm install |PASS; scripts disabled, no audit/fund/network; full898 members checked |
| Types |4/5 PASS; one exact diagnostic mismatch remains FAIL |
| Loaded mutants / fresh-child restores |3 detected /3 PASS |
| Binding negatives |3/3 refused as sealed |
| Additional instrumented mechanical groups |0; unchanged source-qualified private join scope |

The only failing verdict is `types-negative-public-root`: expected TS2305,
actual TS2724 with exit2, saying createGitCommand is not exported and suggesting
createTarCommand. Exact original capture:
`RUN-01/capture/11-types-negative-public-root.stdout.jsonl:2`.
This is an exact diagnostic-expectation mismatch, not evidence that the forbidden
export exists or a justification for product changes. The negative did reject,
but it is **not relabeled PASS**. No compiler/type retry or expectation edit occurs.
The coordinator selects SCOPED_FAILURES/exit1; the outer correctly retains HOLD
rather than accepting284 pass rows with a nonzero overall result. All20 roles
completed because this was an ordinary assertion failure with known cleanup.

Different review must decide the diagnostic criterion in a separately authorized
version if further execution is desired. This handoff offers no execute command
and no automatic continuation. NativeGit6, M1B, private and network remain held.

## Qualification and lifecycle evidence

All14 canonical DATA checks and six startup cases pass, including component-vs-flat
ordering, permutation, changed path/mode/content/link, missing/extra/duplicate,
holes/accessors/invalid Unicode, import/syntax/early-census failures, allPASS/nonzero,
coordinator syntax-only and natural stdout/stderr closure. Their exact membership
is CONTROL-PRESEAL; this does not rerun19+5 or other old qualifiers.

CANONICAL declares exact representable UTF8 pathname-byte ordering, compact tuple
serialization and strict duplicate/data-property checks. Independent Python
expected bytes derive from authenticated old membership plus explicit current
mode witnesses; independent physical reads agree before/after. Old censuses did
not contain modes, so this is not retrospective historical mode certification.
Sparse witnesses are never treated as complete inventories.

Each semantic layout observes180 invocations, ten direct Session close joins,
295 factory streams with295 closed/destroyed/close-delivered,167 actual fulfilled
registrations,295 writes/294 raw callbacks, four owned returns/errors and three
source-qualified native primary errors. Totals:720 contexts,40 Sessions,1180 closed
streams,668 fulfilled registrations and four raw callbacks missing diagnostically.
Raw callback absence does not replace or negate the frozen writer close fallback.
Private writer settlement is SOURCE_LINKED_CONDITIONAL_JOIN, **not a private
Promise timestamp**. There is no new mechanical71 credit.

Maximum unobserved close notifications at outcome is1 per layout; maximum observed
not-closed resources is0. These are distinct sampled quantities, **not a one-live
native allocation bound**. All barrier snapshots PASS, no unknown/secondary error,
trace overflow, integrity failure or admitted pending cleanup was observed.
`FINAL-RECEIPT.notificationRows` identifies the exact cases without normalizing
errors or retrospectively inventing private state. Future late errors, native
allocation/RSS freedom and hostile-host authentication remain outside the proof.

Each layout actually loads224 modules:220 product modules and four harness files.
Full manifest closure is bound; input and actually returned-code SHA256 are logged
before evaluation. Not every package module is thereby claimed exercised. Mutant
loads, sentinels, restored hashes and all type/tool receipts remain captured.
The three cross-layout observation equality checks PASS. AUDIT retains exact
invocation/FS-call, callback, identity, trace and module-role counts separately.

## Capture, clocks and ownership

Outer exclusively opens stdout.raw/stderr.raw/events/receipt before any controlled
seal or census admission. Actual coordinator raw stdout is256bytes and stderr0;
its exit1, signal-null and both stdio closures are independently captured. Unlike
v11, no early-failure capture depends on an inner RESULT. All20 role children plus
coordinator close naturally; no rescue signals or unknown owned handles. Target
has22 processes total, peak3. Control owner+six children also close naturally.
No global OS process census or universal descendant/native lifetime claim is made.

Prep completes through final seal in575.45330025s (9m35s),31 counted processes,
peak2; limit20min/32/4. One DATA-only publisher failed reading the native patch
binary as UTF8; it wrote no seal and reran no controls/target. Its helper and two
Git reads are included. The subsequent publisher read binary bytes correctly.

Outer runtime before final receipt is29768.596792ms
(~29.77s), inclusive coordinator setup/cleanup; final-write tail is not measured.
Raw captures total12787979bytes. Work was31246058bytes,
archived with full directory/file/mode/content identity and verified round-trip
before removing ONLY RUN-01/work. Gzip archive is11376044bytes.
Raw plus encoded working evidence remains below128MiB; owned work remains below
512MiB. Post-target DATA/publication tooling is separately counted in FINAL-RECEIPT:
40 known processes including target and this evidence commit/check recipe, below48.
Preparation, actual runtime and evidence publication are not conflated durations.

Old v5/v6/v7/v8/reviewer/v9/v10/v11 complete file+directory censuses and v12 sealed
files remain unchanged. Original69/H09STOP/215UNRUN and289/288, v11 zero/284 with
partial transcription, all qualifier failures and prior pilot counts stay intact.
Foreign work/index is preserved. No subject or owned worker remains running.

## Versioned hashes

- `census.mjs` SHA256 `62df9336be726a6e18ba261d77f287736b3f0d94d6331eaf7eefc053b8782d84`.
- `outer.mjs` SHA256 `88a502cfe16f4d5e67b5574842a9e455043d439b7d91102eb7943b6ee9120415`.
- `run.mjs` SHA256 `e9e481abc9feb33ff46d26b93b9ba7bd356b103132774a2e16687fa7e3fe37dd`.
- `worker.mjs` SHA256 `7fdffa2d6bbd992546c5f6b203d5c9f25379181a38b1c7d7607531d3db76d1ba`.
- `observer.mjs` SHA256 `8988827da7a4c23b44b563604640333a8121f0fd66a8f3ad47532de1e81afa30`.
- `loader.mjs` SHA256 `bbdd0f3e7e6d1e4083684f749b52b0a97837255344697ac83b06279222dab215`.
