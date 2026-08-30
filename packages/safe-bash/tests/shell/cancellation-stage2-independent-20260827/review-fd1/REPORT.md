# Different Stage2 cancellation review — fd1 synthetic input

## Recommendation and exact binding

Recommend **scoped acceptance** of the authorized invoke-cancellation integration.
No product defect was demonstrated. This is not a whole-gate, timeout-command,
SafeJS, cross-platform, or deployed-provider acceptance.

The executed product is exactly baseline `12e196af8d8b0866339747150b02ca00b9764a09`
plus accepted helper `57855a02` and the five authorized blobs from
`fd1daa123298568546d9ea4e95f8c81dde9c52ff`. It is **not whole fd1 HEAD**.
All 254 source/config/documentation inputs were individually compared with their
designated Git revision, including byte-identical helper SHA-256
`2685ad5723036ef217881e3c3b5f62882a2647e287f518d3cfd4f8416fc330a2`.
The separately authenticated author reconstruction archive is
`51b9013eb0ac70849059403cddf22d5f8f0fab360da7a41e308ae0ca88595e87`.
`REVIEW.json` records every authorized changed-source hash and all raw captures.

The fixture remains freeze `98f400c4` with only approved R08-v3 overlay `7fb923dc`:
effective SHA-256 `b6ff804f0397907930fb41cbe17eb8bd4caf60a4edc2b424341aa80c1c204b7f`.
Original v1 **13/26**, v2 **14/26**, and every previous decision/case byte remain
unchanged. No source, contract, author fixture, root export, package, or WHICH
fixture was edited. The Aug27 cohort directory is retained; execution timestamps
inside captures are authoritative.

## Measured results

| Cohort | Source | Installed package | Physically moved package |
| --- | ---: | ---: | ---: |
| Unchanged v3 runtime/control cases | 26/26 | 26/26 | 26/26 |
| Frozen public/internal type families | 6/6 | 6/6 | 6/6 |
| Explicit-undefined decision type controls | 2/2 | 2/2 | 2/2 |
| Authenticated loaded product modules, not cases | 204 | 204 | 204 |

Strict source build passed. The real manifest was packed with scripts disabled
and installed offline with scripts/audit/funding disabled. The resulting
834-entry tarball SHA-256 is
`87c200daf413d9f1ab835b4d1738a1a93946fd3e350427b01accde4e0b23b1af`, independently
matching the author tarball. Its 832 emitted files match the build entry set,
bytes and modes. Runtime dependencies are empty. Node is **22.22.2 Darwin arm64**;
tool and executable hashes are recorded, not inferred from a current installation.

`focused-01` uses the authenticated concrete package entry URL. `focused-02`
adds a guarded **bare `virtual-bash` import and actual `import.meta.resolve`** in
each installed/moved consumer, then uses that resolved URL for the unchanged
cohort. Both runs pass; they are repeat measurements, not additional families.
The moved consumer has no source tree; old installation/source paths are made
unavailable and excluded from admission. Private frozen helper tests and internal
type families deliberately use the same package's internal emitted modules;
they are not claims that those modules are public exports.

Additional unchanged baseline test replays:

- Invoke/cleanup/env/getopts: **280/280**.
- Core and owned-output author regression tests: **39/39**.
- Runtime/state/descriptor/pipeline/positional regressions: **68/68**.

All listed positive cohorts have zero skipped, cancelled and TODO cases. These
are selected regressions, **not** a new 505-core/203-state/full-gate claim. Existing
env native rows verify their pinned GNU9.7/Bash5.3 and Apple env/Bash3.2 binaries
on Darwin. The additional legacy descriptor helper invokes `/bin/bash` with
isolated fixture data; this does not establish portable or Linux parity.

### Preserved initial staging failure

The first regression execution was **279/280**, plus 39/39 and 68/68. Its sole
failure was reviewer staging: `getopts/native.test.ts` could not read
`evidence/phase1-before.json`. The corrected inventory follows the existing
getopts freeze's paths, adding exactly `phase1-before.json`, `native-cohort.mjs`,
and `verify.mjs` from the same baseline. No assertion/product bytes changed.
`regressions-01` and its exact original harness are preserved; `regressions-02`
contains the corrected complete replay. This failure was not a product defect.

### Existing regression “moved” label is qualified

The unchanged env-shebang regression creates its `.consumer-*` directory inside
the source package. Actual load logs show its bare self-reference resolves
**`source/dist`**, not that nested copy. Its passing semantic row is retained but
is **not** counted as isolated moved-package proof. The separate focused
installed/moved cohorts above live outside the source package, prove their
resolved public export, and deny source fallback. The regression guard's strict
dynamic-copy admission branch was not exercised and is not claimed as proven.

## Frozen weakening classes and supplemental limits

The ten previously frozen classes were concretized only after candidate binding.
All mutation edits occur in task-owned temporary copies, never product files.

| Control | Actual result |
| --- | --- |
| M01 ignore invoke signal | Original R07 rejects |
| M02 reread signal getter | Original R02 rejects |
| M03 remove root settlement priority | Original R09 rejects |
| M04 close borrowed parent | Original R01 fails with real closed-admission error |
| M05 infer provenance from equal reason | **Survives original R13/R14, 2/2** |
| M06 suppress sole root cleanup failure | Original R17 rejects |
| M07 omit attach-then-throw rollback | Original R22 rejects |
| M08 add extra command-budget tick | Original R15 fails with real maxCommands error |
| M09 reverse pre-observation configured controls | Original C01 rejects |
| M10 remove readonly signal | Frozen T02 rejects with **TS2578 only** |
| G01/G02/G03 changed/unlisted/live module | All three rejected by actual loader |

This is **8 original runtime mutations rejected + 1 type mutation**, not ten
original assertion kills. R13/R14's original M05 survivor remains intact.
Post-candidate supplemental S01 checks the private runtime-selection seam with
equal unreported execution/local reasons and a different outer cancellation:
the unmodified helper passes and the same M05 mutation fails.

S02 additionally exercises actual nested `context.invoke`, cleanup-triggered
inner/outer abort, caller liveness and listener closure. Candidate S01/S02 pass
**2/2**; under M05, **S01 fails and S02 still passes**. This explicitly limits the
mutation sensitivity of the actual nested fixture. No supplemental case is
represented as pre-author, and no survivor is erased or called a product bug.
Initial single-S01 execution and later two-case execution have separate archives.

## Runtime/policy inspection

The five-file delta was reviewed against the accepted baseline and helper:

- Omitted/undefined child options take the borrowed path; no owned cancellation
  owner is constructed. R01 checks the two existing scope controller allocations,
  signal reuse, parent liveness and listener balance. This is not heap telemetry.
- `prepareChildCancellation` precedes child admission, reads inherited/accessor
  `signal` once, validates its native brand, and applies ancestor/getter ordering.
  Registration precedes activation, with rollback and one shared finalization.
- Existing invocation Budget is passed to every new Runtime; normal admission
  remains one existing tick. R15 and M08 distinguish cumulative budget from reset
  or extra charges; no product `Promise.race`, new Shell or deadline was introduced.
- Provenance uses the exact invocation/raw-promise boundary, not reason equality.
  Existing mapped handler failures clear the report. R08 now actually verifies
  outer status **1**, public status **0**, unchanged seven inner rejection reasons,
  live caller and held cleanup. This was only a policy expectation before execution.
- Root caller/escaping execution/cleanup/numeric precedence, falsy reasons,
  first delivery versus ranked open settlement, no retroactive closed outcome,
  siblings, pipeline controls and rollback are exercised by the original cohort.
- Env replacement, cwd, literal argv, middleware, getopts cursor/prefix isolation,
  binary overrides, natural EOF and unread input return remain directly tested.

The accepted semantics still concern cooperative resources, not arbitrary host
preemption. Async wrapping can conservatively lose raw-promise provenance; this
review does not invent broader causal proof or a timeout/status124 feature.

## Integrity, cleanup and reproducibility

Every main-loader admitted file is hashed **before execution**. Product, emitted,
fixture and copied development-tool file sets are checked after execution.
Changed/unlisted/live-source imports are negative controls. Captures contain
actual loaded filenames and hashes plus TypeScript `--listFiles` output. Source
and emitted archives, harness versions, tests, TAP/error output and tool hashes
are compact data; no AGENTS copies, private source, runtime dependency or service
download is included.

Every owned scratch root is removed. Direct children complete within bounds with
no signal/watchdog; maintained host tests also assert their direct child is gone.
The final process check finds no command line referring to any exact owned scratch
root. This is not a global process census, arbitrary grandchild audit or claim that
all external resources are preemptible. No private SafeJS checkout was read or
written. **Actual SafeJS 25-profile replay was not performed**; prior accepted
SafeJS results are not substituted for new-feature evidence.

Hash/data-only verification, no product re-execution:

```sh
node tests/shell/cancellation-stage2-independent-20260827/verify-v3.mjs
node tests/shell/cancellation-stage2-independent-20260827/review-fd1/verify.mjs
```

Fresh bounded executions use unused output names and preserve earlier captures:

```sh
node tests/shell/cancellation-stage2-independent-20260827/review-fd1/run.mjs focused-replay
node tests/shell/cancellation-stage2-independent-20260827/review-fd1/controls.mjs controls-replay
node tests/shell/cancellation-stage2-independent-20260827/review-fd1/controls.mjs controls-supplement-replay supplement
node tests/shell/cancellation-stage2-independent-20260827/review-fd1/regressions.mjs regressions-replay
```

The last commands require the same available development tools/native pins.
They never overwrite committed captures or update the fixed acceptance seal.
WHICH77 remains separately queued against its own frozen inputs and root binding.
