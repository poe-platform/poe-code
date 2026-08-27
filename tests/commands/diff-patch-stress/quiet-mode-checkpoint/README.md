# Bounded quiet-mode author validation

Source/tests commit: `96564fe` (`fix(patch): suppress routine progress in quiet
mode`). Historical routed-five archive is the separate `916fbb4` commit in
`../routed-five-checkpoint/`. This checkpoint is author evidence, not the
independent final review or an exact replay of the five benchmark rows.

The patch source SHA-256 changes from
`b344c6f7b0f6afaccdab75778a12c11c868d7f8bccd5d453c56e552039e619fe` to
`72bfb60c502ac5bcaf2efa3e0f044b0ab1d89a54293f829d62f011e7c10e82d7`.
The new author test SHA-256 is
`c42ae03030a5672b6e07435d7a142612bdfcd431f68bcadcecc9826f4ba95aa0`.
`validation.json` freezes relevant source/helper/test hashes before and after
validation, exact commands, timestamps, HEAD/dirty/index observations and log
hashes. Those relevant hashes stayed equal during validation. The working tree
was not globally clean; its HEAD was `cd8b5c8025e9d40ba71594f7b709a42f5249988d`
with the quiet changes uncommitted, before their exact-path source commit.

## Results and preserved failure

- Final focused quiet tests: **41/41 pass**, no skips or cancellations.
- Existing targeted patch, safety, cancellation and GNU publication tests:
  **143/143 pass**, no skips or cancellations. This is a separate cohort.
- Strict scoped TypeScript with **`--noEmit`**: exit 0, no diagnostics. No root
  build, JS sibling emission, global typecheck or global test audit was run.
- `initial-author.tap` preserves **39/40 pass, 1 fail**. Its new quiet-deletion
  control incorrectly assumed exact GNU diagnostic equality: GNU quiet exits
  1 but suppresses the deletion-conflict warning. The product deliberately
  retains that failure diagnostic under the user's preservation requirement.
  No source change was made to hide the warning; the new control now explicitly
  records native empty stdout and product warning as different, while asserting
  equal exit status and file effects. The additional 41st test covers cancellation
  while a retained failure summary waits on stdout. This is not 41 exact GNU
  parity checks, nor a silent rewrite of an existing oracle.

The 41 tests include 27 exact native stdout/stderr/status/file comparisons
(22 paired default/quiet fixture controls, four alias/grouped-option controls,
one default deletion-conflict control), two malformed-input controls preserving
semantic diagnostics and effects rather than claiming identical native stderr,
one explicit quiet deletion-warning difference, one executable identity check,
and ten product-only safety, atomic, budget and cancellation tests. Exact-byte
namespace comparisons include backups and rejects in the paired fixtures.
No failed, rejected or malformed application is reclassified as successful.

## Commands and native boundary

Run from `/Users/kjopek/Workspace/safe-bash`; the recorded commands set
`TSX_DISABLE_CACHE=1` and `TMPDIR` to the absolute owned
`tests/commands/diff-patch` directory:

```sh
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/patch-quiet.test.ts
node --unhandled-rejections=strict --import tsx --test tests/commands/diff-patch/patch.test.ts tests/commands/diff-patch/safety.test.ts tests/commands/diff-patch/cancellation.test.ts tests/commands/diff-patch/patch-gnu-publication.test.ts
```

The full scoped `tsc --noEmit` argv is in `validation.json`. Native controls use
the existing bounded fixture helpers: literal argv, no shell, separate owned
work directories and boundary sentinel, three-second timeout, one-MiB output
limit, C locale, VFS-independent native execution confined to test helpers.
Executions completed normally; fixture helpers removed their own directories.
The verified GNU patch 2.8 executable remains
`/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch`, SHA-256
`c060444da0e547de6f17594baf0b5015a04f5b3277131ca12b1da27c621aee00`.
Its complete identity and native paired-fixture observations are in the quiet
log. `cleanup.json` records verification/removal of the one Node compile cache
file produced by this validation's owned TMPDIR; only empty directories were
then removed. Unattributed `fuzz/.native-bvNFwI` was preserved.

## Remaining boundary

No metadata, FS/backends/contracts/root exports, benchmark or table-text changes
were made. Product code adds no host execution/filesystem fallback, dependency,
unsafe cast or inline comment. Default progress remains unchanged; quiet
suppresses routine progress and per-hunk chatter, but preserves failure/reject
summaries, reversal warnings, errors and deletion-conflict diagnostics. Quiet
success does not write an empty chunk to stdout, including in atomic mode.

The benchmark's native-only empty `tmp` directory under dry-run is still Curie's
profile-fairness issue; these native fixtures use the existing work directory
as TMPDIR and do not replay or resolve that artifact. No phantom VFS directory
was added. Four-row exact closure, patch-hash composition and the stat row await
the independent review under `../routed-five-review/`. Historical 5/5 failures,
original 18/224 failures, original 3750/3758 versus revised 3758/3758, and all
other existing cohorts remain unchanged and were not rerun. No superiority,
full-product completion or 72-hour claim is made.
