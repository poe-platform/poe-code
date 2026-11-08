# Direct independent overlay review: accepted; complete replay: blocked

Date: 2026-08-27. Direct reviewer is different from author Heisenberg. No LLM
delegation, product edit, fixture repair, expectation change, new cohort, implicit
V10 or actual replay retry occurred in this handoff.

## Verdict and remaining blocker

The exact one-file lineage overlay is statically accepted and exercised. One
authorized replay ran from 21:22:41.709Z to 21:23:03.626Z, 21.917 seconds, exit 1,
without timeout. **Every requested semantic phase actually executed.** Overall
acceptance remains blocked by the immutable native diagnostic classifier.

All 16 native rows completed: **13 matched, 3 mismatched**. Each mismatched row
is an explicit invalid CLI `-B` check, selected through DU_BLOCK_SIZE, BLOCK_SIZE
or BLOCKSIZE. The authenticated GNU du 9.7 returned status 1, empty stdout and:

```text
du: invalid -B argument 'invalid-value'
```

Frozen `native-env.mjs:71` requires `/invalid.*block|block.*invalid/iu`; the real
diagnostic contains no `block`. Thus all three are `strict-rejection-mismatch`.
This is the exact actionable classifier mismatch, not an established product
failure, timestamp prerequisite failure, resource-policy failure or reason to
rescore the table 16/16. No matcher or expected diagnostic was changed. Any further
action or acceptance requires the fixture owner's/root's explicit decision.

## Exact identity chain

- Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`; 249 selected paths.
- Pristine V9: `1b2ddea9e38b25cc91134a2f35a318e27f4d7c29`; all 23 files.
- Original manifest SHA-256:
  `474a95bd160636cdbabe03943a0a84aaaeb56d04ab87d25915bb1ac8cbdf9fa2`.
- Overlay: `0bd5a1f3c31ef5e6203a82026181fa0fc73acc79`; seven handoff files.
- Manifest-delta SHA-256:
  `06df5f3200a2c93d4fdf78ad1f968e1e6c29eacbd7b712403b7e0e244f256147`.
- Base harness SHA-256:
  `447ec395027d6d57902e9c22e5d731519d4205da36ea7256c757b6e9de354cfc`.
- Patched harness SHA-256:
  `f857b1f5421d74860515ff60fcfbe52d7a876e488db50a30b94f9f040d8c5e25`.
- Package tarball SHA-256:
  `17ea61cadba802e971cdefd545a56c889d28540b378142870cabacab12b67159`.

`PRISTINE-V9-BEFORE-PATCH.json` records the complete authenticated original
inventory before patching. `PATCHED-V9-AFTER-PATCH.json` records the declared
patched identity and 22 exact untouched files. Every later materialized check
is explicitly overlay-aware. **The old manifest does not validate patched bytes.**
Neither original manifest nor original runner was edited.

PRE and POST are equal for original V9, the overlay, V8, all 408 prior rejection
files, exact candidate inputs and tool bytes. Complete V9/overlay inventories
detect new/deleted entries. The prior evidence check preserves its original
408 files while allowing this separately owned child directory. The index
fingerprints also match across the replay.

Tools were read/hash-bound before semantic execution: Node v22.22.2, npm 10.9.7,
TypeScript 5.9.3, tsx/esbuild/type-package trees, Git/tar/which, immutable process
supervisor, native oracle and reviewer adapter. The adapter's ten exact
orchestration-only replacements reverse to the byte-identical original runner.
All verifier argv, case order and budgets remain unchanged. The extra
DU_V9_MATERIALIZED_ROOT environment variable routes the materialized fixture;
owned temporary/cache overrides are disclosed, not a hidden product overlay.

## Actual counts

| Phase | Observed result |
| --- | --- |
| Author's focused controls, independently executed | 15/15; no candidate import |
| Adapter wrong-base/patch/candidate and two tamper guards | 5/5 reject invalid in-memory admission inputs; zero guard writes |
| Candidate build | exit 0; exact 249 inputs verified after failure, no added non-dist entries |
| Original source / original moved | 24/24 each: 17 holdouts, 7 controls |
| Fresh source / fresh moved | 40/40 each, complete JSON; exact lineage 31/2/7 |
| Source/moved projections | identical; original comparison passed in the runner; fresh comparison also independently checked |
| Metadata/DU source | 19/19; 22 authorized directory-atime deltas; 0 unauthorized; 0 explicit mutation/content-read calls |
| Metadata/DU moved | 19/19; 18 authorized directory-atime deltas; 0 unauthorized; 0 explicit mutation/content-read calls |
| Candidate environment source / moved | 16/16 each, individual raw rows retained |
| Scoped regressions | 128/128; 0 failures, cancellations, skips or TODOs |
| Pack/install/move | completed; all 789 packed and installed files exactly match |
| Strict moved consumer types / runtime | exit 0 each |
| Actual moved-package nextLoad proof | 58 load records, 37 unique physical modules; every source hash matches packed/installed bytes |
| Native environment | 16 executed; 13 matched / 3 mismatched; exit 1 |

The load records include actual DU, Overlay and real-adapter modules. Source
loadedFiles disk hashes are not substituted for moved nextLoad source-byte proof.
Strict runtime confirms root DU export, DU package subpath and default agent DU
registration remain absent.

V5-023 records stable atime during both real-read windows; no universal update
premise is introduced. V5-024 records actual injected atime `4102444800000` in
both modes. File atime and companion ctime deltas both remain unauthorized;
content reads are detected independently. Full observations remain in receipts.

## Intentional negatives and closure

Original behavioral mutant detections: 3/3 per mode. Fresh behavioral mutant
detections: 7/7 per mode, included separately from genuine product windows.
Installed negatives returned the required failure statuses: wrong-root 1,
missing DU 1, restored cleanup 1, semantic declaration 2 with TS2304. Restored
cleanup removed the pending stage and failed measured lstat with ENOENT before
any result JSON; it is not claimed as a completed 40-case negative suite.
Zero-write AGENTS/invalid-packlist controls remain intact. The timeout control
intentionally received termination and its actual grandchild is absent.

**150 replay roots/process groups closed:** 56 bootstrap, 76 materialized,
1 outer replay, 17 native version/case processes. All were rechecked absent.
The focused-control root closed separately. No actual product/native case was
timed out or force-terminated; only the designated timeout control was killed.
Installed mutant directories were already ENOENT. All three retained scratch
roots were archived and then removed to ENOENT. The compact gzip/NDJSON data
archive preserves and re-verifies every byte of 3,211 files. Zero loose new
`.ts`, `.mts` or AGENTS files remain; no AGENTS copy occurred.

The original success-only tail after native failure was not run: its
candidate-inputs-after write, final source/index comparison, RESULTS.json and
automatic success cleanup receipts are absent. Independent post-failure
verification and cleanup are explicitly separate. **No requested semantic
phase remains unexecuted; the run still has no aggregate success receipt.**

## Preservation and limits

Old rejection `b3f45fa7` remains 40 raw markers with exit 1, never an accepted
40-pass rescore. Original first-red controls, twelve fix closures, V1-V8 failures
and neutral diagnosis remain unchanged. Unrecoverable V2-V3 delta remains
permanently unproved; O060 duplicate operands remain deferred/profile gap/
deterministic ordering. Directory-atime listing effects are allowed and recorded,
not full-stat purity. This proof makes no whole-gate, public/default DU,
full-native, GNU/Linux or deployed-provider claim.

A reviewer-only pre-execution syntax typo and its initial binding are preserved
in PREEXEC-SYNTAX-ERROR.data and EXECUTION-PRE.syntax-error.data. It failed before
controls or replay; correcting it caused no actual-case retry. Root retains the
decision over DU public prerequisites and any further fixture work.
