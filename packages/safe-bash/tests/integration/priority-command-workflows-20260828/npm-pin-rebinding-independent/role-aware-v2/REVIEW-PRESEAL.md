# Role-aware v2 independent review preseal

Status: Authorized SOURCE/DATA review procedure; NOT runtime GO

Implemented Through: Not applicable (versioned independent reviewer only)

Date: Friday, 2026-08-28

The root authorizes ONE fresh review of the same nine obligations in immutable
`da0e025b1207e4a2834deaceb517da4b9bad6061` RESULTS.json. Both its null-request
failure and raw-whitespace diff-check failure remain unchanged and unrescored.
This revision repairs reviewer request admission only, not author code/policy.

## Immutable authority

- Packet: `7ef6e6b816ccc6b2449605c7950ab825d148a529`.
- Source authorization: `a52819daa6ff2c867187b01a7a5bbbb189f0da02`.
- Seal evidence: `d6d6ce89c2b87cd92c417c256fde16bf986c91d9` (REBINDING.json belongs here).
- Expected preparation seal: `ab4fb40a7c4f73ddc9a34dba1ebc8a081b214f7fbec549a8b34539b241b39812`.
- Expected template: `6f155760db46aef36e511e15a40a29690ce929c9a78c59366ef6d2cd2d9d47fb`.
- Expected supervisor: `9d8c3843a7fbb777fc85f5b2e7d3766a7f9b22f057765c62754ed6c4de227a3e`.

Only exact immutable expressions from these records and their authenticated
historical binding chains may become metadata requests. No HEAD/default or live
npm/product tree is an authority. The original npm2039 canonical tuple digest is
`76ddb347ab8dce68f6ce84513b57e6489eb5f4a6492a87748db863ef11f9be55`; copied2027 is
`dddb66e1a4d791167c74de1226a4a1263be7485302658eeb7d3ce800c0636d9d`.

## Narrow repaired role boundary

`review-helper.mjs` is the actual opt-in reviewer helper. It is sealed before
import. Its finite own-data record checks precede request construction.
`verified stored commit:path` requires a nonnull full40hex commit, safe exact
path, content hash/length and authenticated containing binding. Active proof
still requires a matching Git blob and exact expression; classification is not
authentication. Source-auth rows separately declare exact kind/OID/hash/length.

`unchanged original seal content binding` requires null commit and an exact
authenticated historical content binding. It emits NO Git expression. Its bytes
are nevertheless checked against the old immutable seal and provenance. Reading
the separately root-pinned evidence tree as historical DATA does not fabricate a
stored identity for the null row or authorize executing the historical file.
Unknown/missing roles, malformed types and bad identities fail before spawning.
No active file disappears from closure merely because role information is absent.

The twelve sealed pure controls are four positives (valid stored planning,
historical-null planning, actual synthetic stored proof, bound historical proof)
and eight negatives (unknown role, byte-length type mismatch, bad nonnull stored
identity, stored-null, historical-nonnull, active missing proof, active wrong
content, historical missing provenance). They run in-process with zero Git
requests. Expected rejection is data, not a failing subprocess. Positive active
proof and missing/wrong-proof controls prevent a constant-reject facade.

## One clock and exact process allocation

Publish the committed preseal handoff BEFORE starting one monotonic origin. That
origin precedes helper import, controls and first fresh source query. Total wall
cap is 600000 ms including analysis, data processing, administrative edits,
commits, cleanup and handoffs. Source admission cutoff is 480000 ms; final120000
is INSIDE the total. Child timeout is min(60000, remaining global time); never a
renewed global budget. No retry after unsafe admission/provenance/child failure.

Planned children: four source-metadata batches maximum (one NUL ls-tree plus up
to three cat-file batches), one final report apply_patch process, and six final
administrative Git commands (staged inventory, add, authored-path diff-check,
commit --only, staged inventory, status): eleven total. One twelfth slot is only
for a distinct necessary metadata closure batch, NOT a retry. Peak two means
the existing REPL supervisor plus one serial direct child. No product/worker
children, shell helpers, hooks, signing, fsmonitor or automatic Git maintenance.
Final apply_patch uses shell exec replacement; its tool completion/exit and raw
output are recorded separately, not silently excluded from administrative cost.

Git executable identity is fixed in the helper: exact CLT path, regular0755,
7604272 bytes, SHA256 `be4afb2b003904725826250de9fb76567bbacf82323457b5a1ec26706b66bcae`.
The existing Node REPL is the declared inspection host, not a newly qualified
Node/npm installation or old-host proof. Imports are exclusively this newly
sealed helper and Node fs/crypto/path/perf_hooks/child_process/zlib builtins.
Archive gzip/JSON and package tar bytes may be decoded as bounded DATA in memory
(64MiB archive,16MiB package); no extraction or execution. No author packet module,
supervisor, compiler, loader, npm, native oracle, private/XAN/YQ or network action.

Aggregate stdout/stderr cap32MiB, work/scratch128MiB. Raw stdin/stdout/stderr and
status/PID/signal/error/timing receipts are exclusive-created before parsing or
asserting. Per-call maxBuffer is at most half remaining capture, so both streams
fit; overflow fails rather than truncating into success. Whole owned-file
membership/hash/mode/size accounting includes additions. Helper/tool/preseal
integrity is checked before/after children; synchronous Git completion with a
known PID and no spawn/timeout error supplies the direct-owned-child reap barrier.
No claim covers escaped descendants, opaque host preemption or hard RSS.

Any nonzero, timeout, unsafe metadata/provenance/integrity/reap outcome is sticky
FAIL and stops source admissions. Ordinary safe data mismatches accumulate only
after integrity/reap. Administrative failure recording/committing may continue
inside the same cap; it never rescales FAIL to PASS. Mutable session counters
survive thrown REPL evaluations; persisted receipts remain accounting authority.
Only newly authored .mjs/.md/.json source/protocol/report paths enter diff --check.
Raw streams, immutable copied DATA and prior whitespace failures NEVER enter
that source-format check and are never rewritten to satisfy it.

## Required dispositions and boundaries

Finish or precisely refute all nine old obligations: original/copy tuple domains;
root PRESEAL versus old BINDINGS; seven literal changes in three executables;
six retained packet files/manifest;314 rows/eight rebound/110 old files; seals,
93case/candidate/package identity; unchanged behavior/permissions/limits; static
assessment of34author DATA controls; actual wall versus conservative charge and
allowance/closure. Independent twelve role controls are NOT those34controls and
never count as workflows. Existing93 workflows remain UNRUN.

Only complete evidence permits ACCEPTED_REBIND, meaning metadata/source binding,
not runtime acceptance. Otherwise report specific residuals. HOLD357fc23a and
the exclusive/unspent/unreleased reservation deadline1788026556000 are inert
history: no consumption, allocation, release, actual setup, new GO or dispatch.
No current npm-tree scan, inherited author score, old-check retry or new chunk.
