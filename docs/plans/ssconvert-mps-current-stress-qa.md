# Current MPS and model export independent stress QA

Executed September 20, 2026 by a different agent from the root implementation
owner. Root owns integration, exports, maintained gates and Git. No commits,
pushes, publication or README edits were made by this cohort.

## Manual procedure

Use the separately built Gnumeric 1.12.61 oracle in the
`ssconvert-statistics-qa` container through Docker context `colima`. Set
`LD_LIBRARY_PATH=/out/ssconvert-statistics-oracle/prefix/lib`, the prefix
GSettings schema directory, `GSETTINGS_BACKEND=memory`, `LC_ALL=C`, `TZ=UTC`
and the cohort HOME `/tmp/mps-fresh-stress`. This HOME was created fresh and
reused within the cohort. The archive identity and dependency/plugin profile
are recorded in `docs/ssconvert/mps-model-reference-profile.json` by root.

Create original minimal XML/MPS byte fixtures beneath
`out/ssconvert-mps-fresh-stress`. Export XML with both
`Gnumeric_glpk:glpk` and `Gnumeric_lpsolve:lpsolve`; export newline MPS variants
with GLPK. Inspect exit statuses, diagnostics and actual model bytes. Do not
invoke a solver or grant native process capability to the product.

Reproduce any defect with a failing original in-memory regression before
editing. Then rerun the independent and root model test files. These tests
neither write files nor spawn native utilities. Unit file effects elsewhere
remain the root's memfs responsibility.

## Verified deterministic cases

All fresh native conversions below exited 0 with empty stdout/stderr.

| Input | Measured native model behavior | Candidate result |
| --- | --- | --- |
| Numeric Target `2` | Objective `0`, not literal `2` | Reproduced failure, repaired |
| Unknown Target `UNKNOWN` | Objective `0` | Existing behavior passes |
| Multi-cell Target `$A$1:$A$2` | Objective `0` | Reproduced failure, repaired |
| Absent Target `$Z$99`, outside inputs | Objective `0`, without zero-variable terms | Reproduced failure, repaired |
| Absent Target/Input `$A$3` | Input allocation creates target; objective `X_1` / `A3` | Negative control passes |
| Singleton Target `$A$1:$A$1` | GLPK objective `X_1 + 0 X_2` | Negative control passes |
| XML local name Goal referring to `$B$1`, objective `2*A1+3` | Target is dropped before deferred name registration; objective `0` | Reproduced direct retained-record failure, repaired and verified through XML import |
| Same local Goal with a global Goal referring to `Sheet1!$A$1` | Same objective `0`; no apparent name shadowing affects discarded target | End-to-end XML regression passes |
| CR-only MPS, objective coefficient 2 | GLPK objective `2 X_1` | Root's repair independently rechecked |
| CRLF MPS, objective coefficient 2 | GLPK objective `2 X_1` | Root's repair independently rechecked |

The target repair follows native singleton-cell semantics and preserves
allocated input cells. Native XML target parsing precedes name completion, so
the writer separately restricts target name resolution when interpreting raw
retained Solver attributes. This is not a restriction on input-name behavior.

The initial defect run had 3 failing assertions and 22 passing assertions.
The named-target reproduction then had 1 failing assertion and 26 passes.
A broader shadow fixture initially failed in the existing XML name-position
parser when using qualified position `Sheet1!A1`; native accepted that input.
No unrelated parser change was made. The final shadow fixture uses original
position `A1`, accepted by both implementations; the qualified-position gap
remains recorded below.

Final focused candidate run: 51/51 tests passed across both files, comprising
28 independent tests and 23 root tests. This includes cancellation, work limits,
output-byte limits, input immutability, native permissive polynomial detection,
invalid variable sets/constraints and the fresh target/negative cases above.
Root runs maintained uncached build, package tests, lint and cross-workspace
gates after the final code edit; this focused run is not a broad-gate claim.

Final inspected source SHA-256 identities:

- `src/codecs/mps.ts`: `a32200942caad9b027563803085beb16b205e5fbed4e7ff62b1a861428e5cac5`
- `src/codecs/model-program.ts`: `5e023d0d084e94e4b264aa21f14b31c32168cdaa3082b0fff8848432f01b5c18`
- `src/codecs/model-program-independent.test.ts`: `934d087d57b5a1ff71290643b7a12b9f1b957626bd6f71a8eb2cf3ed084354d8`

Root's first maintained lint run after this cohort failed with TypeScript
TS2540 at the negative-control fixture's assignment to readonly record `data`.
The fixture now constructs an immutable workbook copy instead. No product code
changed for that repair. The subsequent focused rerun again passed 51/51;
maintained lint and full package tests remain root's separate rerun duties.

## Remaining gaps and unverified cells

- Native accepts qualified global-name position `Sheet1!A1`; current
  `readGnumeric` throws `Invalid A1 address` for that independently observed
  fixture. This is an XML name-position compatibility gap, not repaired here.
- Input-name resolution, input scope shadowing, recursive names and legacy
  `TargetRow`/`TargetCol` metadata are unverified by this cohort.
- No complete fixed/free MPS specification certification, exhaustive float
  rendering, malformed Solver metadata, every supported formula function,
  locale/encoding matrix or cross-sheet duplicate LP name matrix was run.
- Realm/host authority boundaries, original/checkpoint/replay, CLI screenshots,
  byte-sink cancellation and broad integration are root-owned checks; this
  cohort makes no independent pass claim for those cells.
- No solver success or bounded large-model performance measurement was made.
  Deterministic exporter parity does not imply mathematical linearity.
- Native equality-range GLib warning bytes and unknown-section warning bytes
  remain root-recorded diagnostic mismatches.

Remove only this cohort's original scratch directory after retaining these
results. No other evidence or edits may be reverted.
