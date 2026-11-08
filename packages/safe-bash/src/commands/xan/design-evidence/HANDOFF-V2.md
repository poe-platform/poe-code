# XAN refinement v2 compact handoff

Author leaf worked directly, no redelegation. DESIGN ONLY; no implementation,
public exports/defaults/config/AGENTS/shared contracts/runtime/FS/private checkout,
dependencies or other held command changes. Different independent freeze remains
required; no acceptance/full-parity/superiority/72-hour claim.

## Read these

- `../DESIGN.md`: complete proposed API/CLI/selector/display inventory; all 19
  default/hard-ceiling rows, updated approval distinctions and v1 supersessions.
- `PROFILE-V2.md`: exact range/zero-tail profile, raw admissibility/counterexamples,
  existing helper/API binding, provider restrictions, logical accounting and
  remaining decisions. Seven main defaults approved; other defaults and every
  hard ceiling still explicitly proposed, parent budget wins.
- `BYTE-TABLE-V2.md`: eleven exact escaped-byte families, command-specific outputs,
  status/diagnostics, native observation versus source inference/unmeasured cells.
- `REVIEW-BINDING-V2.json`: current read-only source hashes and validation scope.

Original design commit 91bcc1c9ec64e8e0bdb5db3055ee4c8609cd27a2,
DESIGN SHA256 8e27ec025c8277cf4fe422d19f9582c2a1b0ab9f9a5577200a1e449703b11c75.
Primary 0.54.0 source commit 2f9156c8ec79a3ecc09e0879735ac68ec8997b7a.
Binary SHA256 2600a522a9a47d079a9ee93eaa4a2f6e4ce541eb381cde7b41ee6c04a6615d46;
archive SHA256 fded89ddb5941a848a31e40c966c792754ea38dea6b2771fce02879ef197f6c0.
Existing authenticated cache preserved at /tmp/xan-precode-20260828.X6abEd.

## Commits and counts

Original protocol 4e2e582847bc3438f3092f963db05d12fc3bc6c5 and observations
4628da200ba3f79f13a07ea8f5881206f70e6819 remain byte-exact: 28 calls,
23 status0 / 5 status1, OBSERVATIONS not passes. No original rerun/help/version.

Additional protocol 3346e3dd320c63ba0429431a1658b92d145c9efb was committed before
all 16 additional calls. Separate observations commit is the full hash recorded
in REVIEW-BINDING-V2.json (short baf95459): 16 status0 / 0 status1, not passes.
Evidence lives in tests/commands/xan-oracle-prep-20260828/additional-v2/.
This consolidated docs commit is identified in the post-commit candidate file
/tmp/xan-final-profile-v2-20260828-candidate.txt (no self-referential commit hash).

Native distinctions: -s1 -l0 and -s1 -e1 emit remainder; -e0 emits all. -L0 stdin
emits last data row, regular file header only. Cross-delimiter zero-copy decoding
can emit extra quote bytes; moved BOM raw selection can lose a cell's BOM on
reparse. Keep native bytes, but propose faithful reserialization explicitly.

## Remaining root choices / blocker

No missing shared API for the approved observation-time nontransactional safety
profile: compareObservedEntries + actual wx/w writeStream/writeFile are sufficient.
Split Outputs is a concrete guarded-pattern reference, not a directly reusable
multifile/borrowed-stdin-safe API; curl's unguarded writer is not suitable.
No atomic identity-conditioned open exists; that stronger guarantee is OUTSIDE
approved scope. Unknown aliases, absent readStream, missing S3 conditionalPut,
untruthful/unavailable provider authority and noncooperative host work retain
explicit refusals/limits. No invented write-capability gate or host identity.

Root still chooses CR/malformed/EOF details, -L0 VFS operand-kind portability,
same-comma EOF repair/BOM exception details, other limits/hard ceilings and strict
grammar boundaries, and bounded whole-result writeFile fallback. No generic
writeFile(empty)+append permission. All unobserved table cells and all native
chunk schedules remain unmeasured; independent freeze must qualify them.

## Verification and procedural caveat

Runner syntax checked; diff whitespace checked; exact JSON byte strings parsed
for all 11 table families; nine declared native/table matches checked directly.
Seven original evidence files, 44 cached identities and 13 initially bound local
sources unchanged; extra current read-only inputs hashed in REVIEW-BINDING.
These are original-path checks, not an append-proof tree or whole-tree-clean claim.
No product tests/build/typechecks were applicable or run for docs-only changes.

Checkpoint timing requirement was MISSED: malformed apply_patch (missing Begin
Patch) failed, and the same shell continued to the already-sealed native runner.
Checkpoint was then written after calls, explicitly marked late; not backdated.
Protocol precommit and once-only capture were intact. A later table-generation
script had a quoting syntax error before writing anything; direct apply_patch
created the table afterward. Neither failure spawned another native process.

All 16 children naturally closed/reaped; every owned group absent; no caps or
spawn errors, no retries. Bounded raw scratch retained (28 KiB at inspection):
/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/xan-final-profile-v2-20260828-DDAHHp.
No unrelated/native artifacts or existing cache removed. Actual work began
2026-08-28T02:33Z and this handoff was prepared around 02:45Z (about 12 minutes),
still August 27 CDT/America/Chicago; child TZ=UTC never changes host provenance.
