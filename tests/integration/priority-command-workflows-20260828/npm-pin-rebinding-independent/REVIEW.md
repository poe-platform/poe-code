# Independent npm-pin rebinding review — stopped preparation

Date: 2026-08-28

**Verdict: REVIEW_PREPARATION_FAIL. ACCEPTED_REBIND is NOT issued.**

This is a reviewer preparation failure, not a Faraday, candidate, workflow, npm,
or product finding. It does not reject the proposed correction on its merits.
The requested independent review did not complete. No GO is created or implied.

## Authority and preseal

The committed preseal is `a38a588643084ce73264cd27624742127efd8f46`.
Its handoff was published before substantive inspection. Inputs were the user-pinned
packet `7ef6e6b816ccc6b2449605c7950ab825d148a529`, source authorization
`a52819daa6ff2c867187b01a7a5bbbb189f0da02`, and seal evidence
`d6d6ce89c2b87cd92c417c256fde16bf986c91d9`. REBINDING.json resides in the
seal-evidence tree; it is not falsely attributed to the earlier packet commit.

The bounded review used literal Git data only, not packet imports or executable
evaluation. The first child captured the NUL-delimited historical path inventory;
the second captured initial binding/authority/seal/control documents; the third
captured further immutable data. Raw stdout/stderr and child receipts were saved
before parsing. Each of these three Git children exited zero and synchronously
reaped with a known PID, no signal and no spawn error. This does NOT make the
review successful: the subsequent data-admission failure is sticky FAIL.

## REVIEW-PREP-01 — invalid reviewer-generated expression

The reviewer constructed an overly broad request list using:

`artifactMap.map(row => row.replacement.commit + ':' + row.replacement.path)`

That incorrectly treated inert historical-reference entries as stored commit:path
entries. A null commit became:

`null:tests/integration/priority-command-workflows-20260828/stub-controls.mjs`

Git correctly returned a missing-object record. The reviewer parser set unsafe
stop and threw. This is not evidence that the author's stored-object bindings
are invalid. The batch stdout remains in `raw/03.stdout`; no retry, repaired
batch, author control replay or subsequent source-review admission occurred.
Only failure recording and exact-owned-path sealing continued.

The REPL's capture-count scalar after the exception did not reflect the third
persisted receipt. Final accounting therefore sums the immutable per-child
stdout/stderr sizes: **12,077,471 bytes**, not the stale 334,382-byte scalar.
That discrepancy is recorded, not used to waive a cap or rescore the failure.
Final administrative capture and complete disk accounting are in FINAL.json.

## What remains unresolved

- Independent original-2039/canonical-UTF8-no-LF/copied-2027/12-symlink equality,
  traversal order, historical POSIX modes and root PRESEAL provenance comparison.
- Derivation of the seven allowed replacements from authenticated old sources;
  six unchanged packet files; 314 authority rows/eight rebounds and 110 old files.
- Complete seal/template/supervisor hash checks and unchanged inputs, expected
  bytes, 93 identities, permissions, limits, candidate and package closure.
- Independent assessment of 34 author DATA controls (12 positive/22 negative),
  and reconciliation of the author's 516115 ms charge including 60000 ms allowance
  against its 600000 ms bound. Those are author/root statements, not independently
  accepted accounting or inherited control passes.

`BINDINGS.json` in this independent packet records exact already-read identities
and declaration qualifications, NOT a completed validation result. The frozen
candidate is declared as `8437e4eda904e1248c25eeef0d9d455b1d251495` (derived-only
composition, not mutable HEAD); package SHA-256 is declared as
`6b5863d51ecd6484b79b7141a2004c04b775f9894d5b80bb016a02ffbefed40e`.
No current npm tree, candidate tree, private repository or tool inventory was read.

## Preserved history and next authority

Original HOLD `357fc23a`, diagnosis
`ea7e18739c8bcd3d99c803b94a2c5c730d71a156`, old wrong-domain BINDINGS, original
failures, prior author controls and all other owners' files remain unchanged.
All **93 workflow cases remain UNRUN**; independent control replays are zero.
The logical reservation remains EXCLUSIVE/UNSPENT/UNRELEASED, deadline
1788026556000: no capacity allocation, release, consumption or setup occurred.

A future independent review requires fresh explicit root authority and a new
preseal that distinguishes stored-identity rows from inert historical references
before admitting Git requests. This packet neither starts that retry nor asks to
renew the old execution reservation. No product/native/npm/compiler/version,
supervisor/loader/worker, network, YQ, M1B, private or XAN execution occurred.
No owned child remains active; foreign staging and tracked edits are preserved.
