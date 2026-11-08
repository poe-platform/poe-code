# Authorized headerless legacy integrity migration

ROOT explicitly authorized the formerly blocked two-file TEST-ONLY migration.
Only `path-headerless-policy` loses its former `scope: "policy", policyStatus:
126` fields. Its ID, script `PATH=tools; invtool`, fixture bytes and executable
mode remain exact. The existing normal branch now checks status, stdoutHex,
stderrHex and namespace effects against BOTH frozen native profiles. No other
case or comparison assertion changes, no0-or126 allowance or skip is added.

The minimal integrity migration pins:
- Original whole cases SHA256
  `788539627f6f5d8a8b31702ec3b9c7a6477efe8878fa88fa7fd0ae955553ed3b`.
- Exact single-row revised whole cases SHA256
  `fdc22c27541f4f29334274e35238c22fa4645730dbe5239134a585ee8e03f83c`.
- Unchanged original native artifact SHA256
  `86e6be4ec1ad22f3c5956ed0b37d8091653c4858fbf143f35b2e80eae4b67e45`.
- Native `cohortHash` remains pinned to the ORIGINAL whole cases hash.

Only those two exact case files are accepted, and the full native artifact is
now independently pinned before parsing. No expected hash is derived from the
current case file, no mutation normalization or arbitrary acceptlist is used.
The original ID intentionally remains named `path-headerless-policy` to avoid
changing the fixture or raw native57 identities during classification migration.

## Independent proof and validation

`legacy-headerless-migration-evidence.json` retains original and revised exact
file bytes/base64, both whole-file hashes, minimal diff, guard source/hash, fixture
proof and both reused native observations. The unchanged primary GNU5.3 and
historical Bash3.2 captures both report0, exact `native-fallback\n`, empty stderr,
and empty effect map. The fixture SHA256 remains
`b7441278de4509d4fe9cf4dad592fb2ce8edb5887fae485ea10fe66980c40630`.
Native references are REUSED, not fresh controls or per-case oracle selection;
the complete57-row artifacts and all earlier scores remain immutable.

Eight in-memory controls execute the actual migrated guard block, translated
only to remove TypeScript type annotations using existing development tooling:
two pinned files accepted; six mutations rejected (unrelated case ID, extra
case byte, headerless fixture byte, another policy status, native cohort hash,
and native artifact byte). Neither real files nor frozen artifacts were mutated
for these controls. No copied test runner or loader bypass is involved.

CORRECTED72 ran ONCE from03:33:13 to03:33:23 UTC on August27,2026:72/72 pass,
zero failed/skipped/cancelled/todo. Actual import hashes for34 product source
paths and39 total repository inputs match before/load/after. Fixed-input phase
guards also show no drift. Scoped holdout/fixture/harness typecheck exits0 with
168 pre-enumerated and actual compiler inputs; this is NOT a source/global
typecheck. No retry, full suite, new native execution or unrelated repair.

Source was the output-accounting author's DIRTY runtime during both phases:
SHA256 `c7c9d02ddde5576b7810bfecbbd21b70c6eb2c0ea4fe1ee8bee92c21946d8449`,
parser `28492059750ba7f11fad563dfc03dba049f232b3f2212186cf3553e4559ae905`.
Last committed runtime was0f5dbb3; these are NOT its original committed runtime
bytes and NOT output-accounting acceptance. The writer was not stopped and no
source was edited by this verifier. Stable measured imports do not certify a
later source endpoint or clean whole tree. Source/head stamps are in evidence.

All76 recorded child PIDs/groups are absent; no SIGSTOP or watchers. The verifier
script uses immutable output and refuses overwriting existing evidence.

Prior original72/72 and original71/72 on0f5dbb3 are preserved; this run is called
CORRECTED72, never an unchanged-original rerun. The old blocker/proof and0a0f712
acceptance remain historical. Seven nearby raw native losses and the earlier
foreign-drift invalidation remain unwaived. Source frozen-seven progression
0/7→3/7→6/7 is unchanged. This commit does not close output-accounting/Plato env
review, old9 diagnostics, custom5 firstread, broader native/kernel/Bash parity,
or superiority requirements. No new source/contracts/APIs/dependencies.
