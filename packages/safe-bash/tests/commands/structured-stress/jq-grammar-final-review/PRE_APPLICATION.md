# Independent pre-application verdict — August 27, 2026 UTC

**APPROVE the bounded source handoff, exact native v3 patch, and separate
conditional host patch. Neither patch has been applied at this checkpoint.**
This verifier is neither source nor proposal author; no delegation. Application
authority is the user's explicit conditional instruction, not this report alone.

## Pins and prerequisites

- Source: `09926fb67452ca7db9bd793d87b78d2f41ff82be`.
- Structured SHA-256: `913886e89fce8626d28f957d978243e3b8dd6bf94dd14348f5331f47607b4fb1`.
  Checked with the unchanged old `sourceSnapshot()` before first product import;
  all structured files also compared with that commit, then checked every phase.
- Proposal: `eab1d48a90456c1c2cdeb9289b32f1ed62429137`; every committed proposal
  file matches. Native patch SHA-256:
  `c83cd9adabd99925007bb79332899913829166ac21a6a25353dcfd199196627d`;
  host patch SHA-256:
  `18abf8765ce8474b30b0704063743f2e93217a19810a568160b4c30736187f0b`.
- Source-author README/REPORT and complete evidence match `2dbb27c`. The
  `/tmp/safe-bash-jq-grammar-review-fix-report.txt` closing marker appeared and
  was read before approval; its text/hash is retained in `pre-approval-audit.json`.
- Source-review history remains pinned to `0f82d80`; preparation remains pinned
  to `d5b8fff`. No arbitrary current structured hash substituted.

## Independent source verification before application

| Cohort | Source | Full in-memory emitted root |
| --- | ---: | ---: |
| Whole original main256 | 790/790 | 790/790 |
| Original42, included in main | 84/84 | 84/84 |
| Whole legacy94 | 376/376 | 376/376 |
| Independently prepared35 | 178/178 | 178/178 |
| Four frozen reviewer vectors | 16/16 | 16/16 |
| Four source-author neighbors | 16/16 | 16/16 |
| Prerequisite, overlaps grammar35 | 4/4 | 4/4 |
| Original host four classes × two inputs | 8/8 | 8/8 |
| Same four classes, stderr runtime/preflight | 8/8 | 8/8 |

The two whole-cohort phases each execute 1,344 unchanged cases, without skips,
normalization, selector changes or missing pipeline stages. Frozen input/output,
chunk routes, literal argv and file/namespace checks are retained. Source main
uses the original public harness; other cohorts and emitted root use the frozen
executor. Emitted root uses actual `tsconfig.build.json`, intercepts all writes,
loads 130 emitted runtime modules (520 outputs), rejects source runtime imports,
and never writes `dist`. This is not an installed-package test.

Seven old stderr boundaries pass 7/7 in each of three strict/watchdog runs.
New limits6 pass 6/6; author limits9 pass 9/9. Old safety+limits is 24/25 and
old author114 is 113/114, both retaining the original JqError sink assertion.
Historical controls238 and nearby117 pass in full. Broad unchanged suite is
1550/1580 with **exactly the same 30 failure names** as the previous reviewer;
author grammar suite is 2157/2157. Scoped, author-scoped and global TypeScript
all pass now; earlier unowned global-type failures remain historical evidence.

All pre-phase endpoint product/tooling hashes are stable; source and compiled
whole phases use product `1762b02d6655fb30647d760ca59928157ce7c972e78ba58e30dacef9a3f2cd30`.
No drift rerun was needed. This is a shared dirty worktree, not clean committed
HEAD or a whole-product acceptance claim. Timings and full snapshots are in JSON.

## Source reasoning and host policy

The actual three code edits register only `isfinite/0`, test numeric type and
exclude both infinities, and remove only the container ordering identity shortcut.
NaN remains numeric and not infinite; nonnumbers do not pass. Ordering now
descends aliased arrays and objects; equality retains its independent identity
shortcut. Each recursive compare charges `budget.step()`; finite/key-order paths
are unchanged. Limits tests verify step exhaustion and abort identity, zero-input
arity rejection, result/output limits, optional-filter limits and blocked writes.

Primary semantic review consulted tagged jq1.7.1 `src/builtin.jq` (isfinite),
`src/jv_aux.c` (recursive ordering), and `src/jv.c` (equality identity), fetched
from `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/`.
These support reasoning; byte expectations remain frozen Apple jq1.7.1 captures,
not a claim that the Apple binary is identical to upstream source.

The documented root ruling is origin-based host failure identity. Independent
checks exercise generic Error, FsError EPIPE, FsError EIO and JqError on stdout
and stderr, plus `writeBytes` identity. They verify rejection identity, one
attempt/no committed output, no opposite-sink write, no extra input, iterator
cleanup (or no input acquisition for preflight), and empty VFS namespace. The
host patch is **approved separately as an observable typed-sink policy change**,
not native parity or a stale-native refresh. No shared lifecycle/API change.

## Proposal reasoning: R1–R4 resolved

- **R1:** reviewed actual full snapshots and both unified patches, nonoverlapping
  edits, all preserved spans and the two opt-in byte helpers. Both non-applying
  `git apply --check` calls pass. Exactly 12 native paths plus one host path.
- **R2:** exact status/stdout/stderr bytes replace decoded-only comparisons.
  The actual proposed callbacks reject all 14 frozen same-decoded-text byte
  mutants. Helpers copy captured chunks (including reused Buffer views), retain
  legacy result shape, overrides and limits; new raw fields are opt-in.
- **R3:** all 464 original/proposed selected invocation schedules match (29
  registrations, 96 constituents, 90 unique input keys). Each lookup requires
  actual argv/input/files; missing and duplicate keys fail. Default helper stdin
  is precisely string `null`, not empty bytes or omitted lookup input. Baseline,
  generator calls, single/slurp, 29 resource constituents including the inline
  surrogate, and 36 CLI mode/input pairs remain represented.
- **R4:** exact six-index override set `{5,14,15,16,21,22}`; the pre-existing
  successful exponent index20 and sixteen failure branches remain. Names now
  describe acceptance/replacement honestly. The 13 raw override IDs are explicit;
  original raw fixture JSON is not a target. All 373 unselected registrations,
  timeouts, shared-loop call/assertion traces, and 93 untouched top-level
  statements remain. The unsupported `split/2` branch and no-acquisition guard
  remain unchanged; the correction does not expand supported features.

Proposal `verify.mjs` ran without recording or product imports. Its simulations
prove assertion wiring/schedules, not product semantics; the independent product
runs above and complete post-application runs are distinct obligations. The host
callback retains reads/writes/cleanup and EPIPE control, requires JqError identity
and zero stderr; status conversion, added diagnostics and extra-read mutants fail.

Supplemental literal evidence `013c1afdbda1d017beacb2c61771ef8a32cad41b` matches
byte-for-byte. Report SHA-256 is
`08b138d97e839a678e6c4120ef14f16dabb24ea82cf30ea02abc4e19d5ed44b6`.
Both proposal file keys match exact argv, stdin `98800a`, regular nonsymlink
`unicode-start` bytes `f09f`, expected tuples and before/after metadata. Four
captures and two metadata queries pass with reaped children and confirmed cleanup.
No redundant recapture needed. Earlier unavailable/FD-only observations, including
the proposed JSON's literalFileLimit field, are preserved dated truths, not current
blockers. The 88 other native keys each retain two exact captures.

## Authorized next phase and limits

Apply only manifest after-bytes, native12 and host1 in separate TEST-ONLY commits,
without these review artifacts. Then run complete changed and relevant structured
suites, safety controls, both full frozen cohorts, scoped/global types and in-memory
build. New delta-aware preservation must accept only those exact13 targets while
retaining all old fixtures/results/before snapshots and frozen vector bytes.

Historical original22 and original94 (45 exact/49 differences:43 stderr+6
acceptance) stay dated; original42 accepted790 remains a separate closure. The
earlier 174/178 and alias0/4 failures are retained, not rewritten. This approval
is not full jq, Bash, backend interoperability, project completion, just-bash
superiority, universal native compatibility or evidence of 72 hours' work.
