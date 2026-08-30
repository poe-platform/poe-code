# ERE native-reference executable preflight — HOLD

Date: 2026-08-29. Author materialization and DATA controls only. No independent
acceptance, root runtime grant, tool approval request, Bash execution, native
observation, product execution, or reference-version probe occurred.

## Frozen identities

- Parent proposal: `8f85329b9e6906947ff3c1805447e90c3d60bcae`.
- Parent packet: `7ceac39234b1ce5e789bfb9d5452ec9cf7c718284c2ce78b8c5434dad64a42a1`.
- Executable preseal: `d002ec622f7668b0766216acd60d19330723d4552205f3049202898eccdbca2f`,
  at `../materialized/PRESEAL.json`.
- Twelve-control preseal: `89bea43a9445b940dae42147cf798a79196745f1bdcc4c5b22cbcaef4c83c06f`,
  at `CONTROL-PRESEAL.json`.
- Tool approval proposal is the unchanged parent template, SHA256
  `ac31d4d5e36efc135ac9f3a398c42ca6138175db8a51eb5b62bf3596a098c303`.
  It is not an approval request and its sole grant-hash slot remains unresolved.

The materialized profile contains nine modules, four JSON inputs, and twelve
unchanged program files: 25 members plus its preseal. `MATERIALIZATION.json`
records the exact source transformations. Seven modules equal their inert draft
bytes; entry and admission differ. Original proposal/drafts remain unchanged.

## Control result and concrete blocker

Exactly C01–C12 ran once: **11 PASS, 1 FAIL**. There were 155 assertion attempts;
154 returned successfully and one failed. These are DATA/helper assertions, not
native semantic passes. `CONTROL-RESULT.json` and `raw/controls.*` retain all rows.

**C07 fails:** `validateOuter` uses a zero-length read to test descriptor read
access. A genuinely opened `O_WRONLY` regular file passes that operation on the
pinned Node runtime; the control reports `Missing expected exception.` The
read-write positive, four identity/type/mode/path negatives, and read-only
negative precede it successfully. The write-only negative is assertion seven.
No target or wrapper was launched. The descriptor closes in `finally`.

This is a harness admission defect, not a Bash capture-model finding. Do not
activate this entry. A minimal candidate correction is a bounded, positional
one-byte read (no cursor advance or writes), followed by the existing write-access
check. That correction is **proposed, not applied or verified**. Preserve the
failed negative; a successor needs source binding, syntax qualification, and
independent review. Three later C07 checks (unchanged contents and two provision
checks) did not execute because this assertion failed; do not credit them.

| Control | Result | Exercised role |
|---|---|---|
| C01 | PASS | Exact twelve, order, zero fixtures, twelve file/program byte bindings |
| C02 | PASS | Hash/argv/executable/stdin drift refusal |
| C03 | PASS | File metadata/hash-before-decode, import closure, tool identity refusal |
| C04 | PASS | Exact own-data receipt, wrong/missing authority, cross-realm data |
| C05 | PASS | Expiry, inclusive final deadline, late credit, false-valued primary identity |
| C06 | PASS | Sole slot, exact command fields, prefix/login/permission drift refusal |
| C07 | FAIL | Write-only FD accepted by zero-length read check; later checks UNRUN |
| C08 | PASS | Flush/size/hash-read/close failures, independent cleanup, no credit |
| C09 | PASS | Synthetic TERM/KILL timing, exit+close+group absence, source linkage |
| C10 | PASS | Exact six-key environment and trusted startup scope; no ambient reads |
| C11 | PASS | Synthetic NUL/status/empty/unset framing and malformed data refusal |
| C12 | PASS | Ledger/namespace/storage predicates and unknown-retirement credit refusal |

C09 is synthetic plus authenticated source linkage, not a new lifecycle pilot.
Zero harmless fixture children were used. Historical qualified v3 lifecycle
controls are not silently rescored as this cohort's actual execution.

## Admission changes requiring different review

All module bodies are admitted and parsed unlinked/unevaluated before controls;
the native entry is never imported. Controls import only admitted side-effect-free
helper modules. Parent members and four executable identities are authenticated
before control execution; executables are stream-hashed, never decoded.

Entry no longer decodes unpinned `PREPROVISION.json`. Outer descriptors are checked
first; grant, executable preseal, requests, receipt, and provisioning bytes must
pass regular-file, size, mode and SHA checks before JSON decoding. Requests are
read again through the authenticated bounded reader rather than a bare reread.
Manifest paths are finite, unique, contained, and exclude cyclic authority files.
The entire twelve-case request/environment binding runs before any case setup.

The proposed receipt has exactly these ordered own data keys:
`schema, decision, profile, presealSha256, requestsSha256, reviewer, reviewCommit`.
The proposed grant has exactly:
`schema, decision, profile, deadlineEpochMs, startupScope, preseal,
independentReviewReceipt, preprovision, limits`.
Neither object is created as runtime authority in this phase. Grant `preprovision`
must pin the future `materialized/PREPROVISION.json` path, 0600 mode, bounded byte
size and SHA. It is outside the executable preseal to avoid a hash cycle.
The future provision document has one `parents` array in root/outer/cases/captures
order, each with exact `path, device, inode, mode` data; all four directories 0700.
Fresh namespace/JOURNAL setup and a separately authenticated provision receipt
still belong to the future preactivation preparation, not this execution grant.

## Original qualifications and next authority

Initial tool-shell startup is trusted host/tool behavior **outside** child fresh
environment and owned raw capture. `login:false` does not imply startup suppression;
no startup files were inspected or modified. The wrapper structure is unchanged,
but no wrapper derivative or actual native entry was executed here.

N01–N12 remain **12 UNRUN**, zero fixtures, empty stdin. The proposed actual budget
remains 600 seconds inclusive, 40 known starts/13 managed, peak three known roles,
64 KiB per stream, 32 MiB capture and 128 MiB work. These are proposals, not an OS
census, hard containment, or an active allowance. The reference is the historically
observed pinned local Bash 3.2.57, not GNU 5.3. Native spans and participation hidden
behind identical empty strings remain unobservable. R01 stays HOLD.

Next: repair/version the C07 guard and finish its remaining control coverage;
a DIFFERENT reviewer must review the actual executable/authority/source closure.
Only then may root publish a fresh receipt/GO and separately DATA-review the sole
resolved SHA slot before an actual `require_escalated` request. No old37 grant,
expired authority, source-build/P2, or other held work is reusable permission.

## Capture, retirement and publication

Every Node syntax/helper invocation had separate regular-file stdout/stderr
captures established by the outer shell before launch. The first qualification
refused an illegal octal escape in a synthetic DATA string; original
`controls-r0.mjs.data` and `raw/qualify.*` are retained. No controls executed in
that refusal. R1 corrects it and two source/predicate spellings before the single
control run; no product expectations or twelve native programs changed.

Control file descriptors close synchronously; scratch was removed; the final
sealed-source integrity check passed. The control owner retired with exit 1
(failure retained), not a falsely successful aggregate. No owned process remains.
Publication inventories closed captures; its own live stdout/stderr are excluded
from the recursive self-seal and instead retained as ordinary commit-bound raw
files after the publisher retires. See `PROCESS-ACCOUNTING.md` and `PUBLICATION.json`.
