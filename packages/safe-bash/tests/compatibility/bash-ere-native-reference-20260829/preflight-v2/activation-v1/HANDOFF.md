# ERE12 activation binding — separate resolved-slot review required

Date: 2026-08-29. **DATA preflight PASS; zero native execution.** Poincare must
separately accept the resolved slot before any actual tool approval is requested.

## Fixed issuance and expiry

- Issued: **2026-08-29 10:01:09.884 UTC**.
- Expires: **2026-08-29 10:46:09.884 UTC**, exactly 2,700,000 ms later.
- Latest permissible actual start leaving the full 600-second window:
  **2026-08-29 10:36:09.884 UTC**.
- No automatic renewal, expired execution, default-mode route, old grant, version
  probe, source build or retry is authorized. Approval rejection or unsupported
  approval must STOP. The present task does not request that approval.

`ISSUANCE.json` binds the declared issuance instant, immutable GO hash and times.
The runtime schema has no issuance-time field; it carries the exact absolute
expiry. The sidecar records issuance rather than changing the accepted schema.

## Exact authority and command bindings

| Object | Bytes | Actual mode | SHA256 |
|---|---:|---|---|
| Runtime ROOT review receipt | 424 | 0600 | `644630c96f3cdc647aabd9f21cf6c660d2c982fd75b0d8b33c61b241168e2476` |
| Physical provisioning receipt | 695 | 0600 | `309a4cdfa95f6b84e88bf69c1ad9e5a459bd1dc742f20845cd172dca3185ee55` |
| Fresh GO | 1796 | 0600 | `9eec9e95250998fc3bf78ee8727bbfbbba6d32c7aab42155291a5cea34a753ec` |
| Exact resolved parameter object | 1295 | 0600 | `d2dca84a74ff36a2a7fae05986f237acd5cf3d8c35caa3e4d97ee96344d6460d` |

The first three objects are `../materialized/REVIEW-ACCEPTANCE.json`,
`../materialized/PREPROVISION.json`, and `../materialized/GO.json`. Exact future
`exec_command` parameters are in **`RESOLVED-COMMAND.json`**, not an executed request.
The UTF-8 command-string SHA256 (no added newline) is
`9423c7e1d4bbbc6c77bef3962bfe97b93fe333f65263cb2f4df12f555a239e25`.
Only `ROOT_APPROVED_GRANT_SHA256` is replaced in the accepted template. All other
parameter bytes/fields, including `require_escalated`, `login:false`, no prefix rule,
workdir, shell and justification, remain exact. Do not edit them during activation.

Actual 0600 modes derive from authenticated owned exclusive creation plus current
stat observations, not Git's regular-file index mode. Physical parent identities
are recorded; do not reconstruct them from Git metadata or silently chmod copies.

## Review authority is not confused with runtime authority

Stored commit `f5d9e55ec3f3643904f1ec51d1cfa110b6a6dea8` was inspected directly.
Its `tests/compatibility/bash-ere-native-preflight-review-20260829/HANDOFF.md`
(1892 bytes, SHA256 `5ff1400f9621fef789cf42f9867aaa4817b21d1850c4f17ced17edc6d97d544b`)
identifies **`REVIEW-RESULT.json`**, SHA256
`679e7e6cb7beade1a5816725d9efea133d74bcd3617e23601d3fd73b83c002f3`.
That committed object explicitly has schema
`ere12-independent-preexecution-review-v1`, decision `SCOPED_PREEXEC_ACCEPT`,
`notRuntimeReceipt:true`, and `nativeAuthority:false`. It is preserved verbatim.

The separate new ROOT receipt uses the exact seven-key schema required by the
accepted `admission.mjs`: `ere-capture-independent-acceptance-v1`, ACCEPT,
`ere-capture-reference-v1`, accepted preseal and requests hashes, explicit
ROOT-ratified reviewer label, and the full independent commit. It does not pretend
the non-runtime result was already a runtime receipt. `ROOT-REVIEW-MAPPING.json`
binds the exact stored object, schema, source paths and both receipt roles.

Authority order is acyclic: committed scoped review → ROOT runtime receipt → GO
pinning receipt/preseal/provision → sole-slot resolved command. Neither the runtime
receipt nor GO refers to the later publication/commit or future slot-review hash.
That future separate acceptance is a ROOT/tool-dispatch condition; it must not
rewrite this receipt or grant after the command hash is sealed.

## Source and physical preflight

- Frozen source: `2d07f5921010fda988dcda36ac81a89831fbac55`.
- Executable preseal:
  `211483cbe1b12ad505345da5396a227c7da9931743d035ed365f7cc74bb4d457`.
- Author control seal:
  `b73f207cb4dd7e5a8c903075f4219cd27635b03f3be16f947846c7ff42943b03`.
- Requests:
  `2678d8619553f9d8d9669f078c29847c65c31984ebd0ab6bdeeea271a213acc8`.

All nine modules, twelve literal programs and four runtime JSON inputs were
reauthenticated before decoding; all nine modules syntax-parsed unlinked and
unevaluated. No module/program/guard was edited. Four executable identities were
freshly stream-hashed. The entry is never imported. Only the accepted admission,
provision/cohort and sole-slot guard functions run as DATA checks. Postchecks
reauthenticate their complete selected source closure.

Fresh root `/private/tmp/safe-bash-ere-native-observations-20260829-v1` was absent
before exclusive creation. Root, `outer`, `cases`, `captures` are owned 0700
directories. `JOURNAL.jsonl` is an owned, closed, empty 0600 file needed by the
accepted append-only journal. The three subdirectories remain empty; case work,
HOME, TMP and empty PATH directories are created only by the future native owner.
`outer/bootstrap.stdout` and `outer/bootstrap.stderr` intentionally **do not exist**:
the approved noclobber wrapper must create/reopen them itself. Parent device,
inode, mode and canonical-path checks pass. No preexisting path was overwritten.

These staged paths remain owned/reserved for the conditional future run. They are
not running resources and are not automatically deleted on expiry. If activation
does not occur, root must decide their guarded disposition; do not reuse them for
a fresh grant or pretend an expired grant was renewed.

## Conditional actual scope remains unchanged

No actual until separate resolved-slot ACCEPT, this committed fresh authority and
preflight PASS, sufficient time for a full 600-second start, and exact tool approval.
The initial tool-shell startup is **trusted host**, outside child fresh-environment
and raw-capture qualification. This is outside the custom test sandbox and is not
an OS containment claim. Do not inspect/mutate startup files or infer suppression
from `login:false`.

Only pinned `/bin/bash` 3.2.57, twelve N01–N12 programs, zero fixtures/empty stdin,
exact child LC_ALL=C/LANG=C/TZ=UTC and owned HOME/TMPDIR/cwd/empty PATH are in scope.
No BASH_ENV, ENV, exported functions, external commands, network/private paths,
product/virtual/comparator/engine work or GNU5.3/P2/XAN/old-gate resumption.
Inclusive actual budget: 600 seconds including setup/cleanup/flush/publication;
40 all-known starts including administration, 13 managed planned, peak three;
3-second cases, TERM2/KILL1; 64 KiB/stream, 32 MiB capture, 128 MiB work.
Internal fork reservations are not a census or kernel quota.

Raw statuses and NUL cardinality/values are **observations**, not passes. No hidden
span/participation inference. Credit requires qualified flush/hash/close/retirement
and deadlines. Safety/capture/integrity/unknown-retirement/cap/deadline/auth STOP
consumes the actual attempt; no retry. **All twelve observations remain UNRUN.**

## Preserved preparation defect and accounting

The initial metadata helper read the shared output FD at EOF, producing an empty
in-memory value despite a complete `commit\n` raw file and normally retired Git.
`read-review-r0.mjs.data`, raw error and type capture remain unchanged. R1 uses
bounded positional reads, authenticates that existing type capture, and fetches
only the two not-yet-read handoff records. No Git-type retry, authority relaxation,
native effect or new grant was hidden in that correction.

This preparation uses **32 known direct starts**, including publication, peak
three known roles. All processes retire; retained physical staging is declared
above. See `PROCESS-ACCOUNTING.md`, `PREFLIGHT.json` and `PUBLICATION.json`.
