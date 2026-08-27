# Frozen file holdout: initial checkpoint

Candidate: `d168d18b118592e04a6eec9b00eb50cc2b1e5058`.
Original preseal: `8b4a48a3c4f189b1d98707354a2eb469af3527250cca7e6bc36f02ed86e04297`.

## Results

Exactly 40 isolated one-case children ran once, August 27, 2026,
08:27:13.735–08:27:16.370 UTC. All children completed normally; this is not a claim
that all tests passed. A child had a 60-second limit and the run a 10-minute limit.
No new native captures, extra formats, full gate or default integration ran.

| Lane | Result |
| --- | --- |
| Frozen content semantic views | 80/80 accepted across 20 fixtures |
| Native exact combined MIME/encoding | 16/20 |
| Native exact MIME type | 17/20 |
| Native exact encoding | 17/20 |
| Native machine-view total | 50/60; not 80/80 native parity |
| Human labels | 20/20 semantic; exact prose not required |
| Raw scenario semantic statuses | 35 pass, 3 fail, 2 backend-limitation |
| Adjudicated scenario statuses | 31 pass, 4 native-profile-conflict, 3 harness-defect, 2 backend-limitation |
| Unsupported / unavailable native content views | 0 / 0 |

The original 109 native reference observations are unchanged PREP evidence, not
109 new captures or candidate passes. Workflow native lanes remain not-run;
their contract assertions are separate. Raw human text is retained, not normalized.

## Issues and qualifications

- **SQLite MIME:** F16 emits `application/x-sqlite3`, while native and the IANA
  registration use `application/vnd.sqlite3`. The sealed semantic alias set accepts
  the legacy spelling, but native-exact comparisons fail. IANA explicitly deprecates
  that alias except for backwards compatibility; no such requirement was supplied.
  Route `SQLITE-MIME-001` as an avoidable interoperability bug/recommendation, not
  a blanket profile waiver. No production fix was made.
- **Harness signal identity:** F29/F33/F34 incorrectly require the same signal
  object. Valid `AbortSignal.any` composition violates those predicates without
  violating propagation requirements. Raw failures remain unchanged and are not
  counted as passes. F33/F34 passed prompt cancellation/exact caller-reason checks,
  then stopped before late-read/return rejection injection. Those later obligations
  remain unverified; no predicate rewrite, corrected cohort or rerun occurred.
- **Other native profiles:** F07 partial UTF-8 and F18 truncated PNG are strict
  binary fallbacks instead of native legacy 8-bit text. F12's ASCII PDF is binary
  in the candidate versus native `us-ascii`. All three remain native conflicts.
  The author's separate `iso-8859-1` PDF is not this holdout fixture.
- **Backend limitations:** F30 known-large readFile-only input and F31 metadata
  ENOTSUP are safe refusal characterizations, not successful classifications.
  No invalid/missing `FileStat.size` was fabricated as a conforming provider.
- **PE/Wasm:** IANA registrations support the candidate's registered names, but
  these formats were not extra specimens in this initial corpus. Author-native
  results are not counted as independent evidence here.

Detailed routing and minimal preserved reproductions are in
`evidence/failures.txt`. Primary registry bytes/URLs/hashes are in
`evidence/primary/`. Raw rows, output, filesystem/signal events and module logs
are in `evidence/results/`; no diagnostics or expectations were rewritten.

## Execution boundary

The entire candidate source/config snapshot is from the exact commit: 209 regular
files. Seven installed development package versions/integrity metadata match its
lock; 318 dependency files were copied, dereferenced only within node_modules,
hashed and locked in temporary storage. This does not independently verify npm
tarball integrity. No dependencies are vendored in this evidence directory.

Scoped TypeScript compilation of the file-family and Shell entrypoints succeeded,
emitting 63 files. Runtime imports resolve only into frozen copies or Node builtins;
the audit records 25 file modules, with product builtins `node:path`,
`node:stream/web`, and `node:util`. All 590 source/dev/build hashes and 54 holdout
artifact hashes match after execution. No moving live source imports were used.

The mechanical bridge uses the actual `createFileCommand`, `fileCommands`,
`FsError`, and `Shell`, with explicit plugin registration. Root/package exports
remain absent by design. It registers only the independent binary producer, never
a replacement `file` classifier. All five Shell attempts were disposed; four
completed normally and the preaborted attempt rejected with its caller reason.
F38 exercises binary pipe chunks plus input redirection; F39 exercises ordered
named/stdin/empty operands and brief mode. No additional complex-pipeline cohort
or universal shell claim is implied.

The declared test profile uses `maxSniffBytes=65536` and
`maxReadFileBytes=65536`; the latter is intentionally stricter than the candidate's
1-MiB default to match the frozen fallback probe. Other family limits are default.
Shell output is capped at 65536 bytes with a 32-byte pipe high-water mark. Family
quotas are invocation-local, not a fabricated shared shell budget. Frozen source
review confirms that supplied shell sinks/signals remain in use; this scoped run
does not establish all global quota interactions.

Completed cases check prefix range options, early iterator return/no extra next,
Unicode chunk boundaries, oversize-chunk sample isolation, awaited sink writes,
unchanged retained sink bytes, permission/race diagnostics, virtual symlinks,
directory/empty flows, and actual Shell pipelines. Upstream allocation/prefetch
cannot be prevented by a byte consumer. Pending host promises cannot be forcibly
stopped, and the identified late-error assertions are still incomplete.

Static review of the frozen file-family source and loaded closure found no product
subprocess, host file access, host libmagic, third-party runtime dependency,
decompression, filename-extension classifier, or filesystem mutation path. The
host-escape canary passed only its exercised virtual-link route; it is not universal
sandbox or provider-deployment proof. Header classification is not payload validation.

## Preserved evidence

`sealed/catalog.json` maps the original 54 paths to `sealed/artifacts/H...` files.
Those files preserve exact bytes; symlink artifacts preserve exact target spelling.
Opaque storage prevents archived TypeScript contract snapshots from entering the
repository's live typecheck. `restore-sealed.mjs` reconstructs them only under /tmp
and verifies the original public seal. No sealed fixture, runner predicate, or oracle
was changed. `harness/` retains the separate bridge/selection/observation tools.

Only separate case selection and the selected-row count are instrumented in the
derived runner; `evidence/binding.json` records both exact replacements and hashes.
Source/dependency/build manifests, original hashes, all raw statuses, and the
additive adjudication are retained. The author handoff is preserved as provenance,
not substituted for independent evidence.

No author fix, commit, staging, public/default integration, full gate, provider
verification, performance comparison, broad libmagic parity or superiority claim.
Root must authorize further work; this stops at the bounded initial checkpoint.
