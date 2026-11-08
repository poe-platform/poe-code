# Two-row derived correction — prepared, not executed

This is an explicitly authorized additive harness correction, not a reseal of
the original six inputs or a new independently withheld corpus. Original run:
four scoped passes, two HOLD/zero-invocation; see `../safety-run-evidence/README.md`.
Current actual product commands across both phases:4. Derived commands:0.

Changes are restricted to:
- T-DP-cumulative: same64 names/pattern/args, maxSteps4096→16384.
- T-sort-many: identical inputs and4096 budget.
- Both: actual documented Shell status1 and meaningful bounded work-limit stderr
  replace the incorrect outer-rejected-promise/empty-stderr expectation.
- Telemetry observes listing traversal so DP cannot pass on a later-sort failure.

`case-diff.json` lists exact input/oracle changes. `derivation.json` records every
literal transformation for the copied controller/oracle/loader; `child.mjs` is
byte-identical to v1. Other original oracle branches and common safety assertions
remain unchanged. The new VFS wraps the original readonly fixture, preserving
entries/options and recording bounded iterator progress. It adds a no-resource
return observation; this is disclosed in `STATIC_PROOF.md`, not hidden as an
unchanged fixture implementation. No product source or shared executor changes.

## Phase proof required

DP singleton4573 fits16384; four full filters demand18123. Expected observed
prefix:4 names, nonexhausted listing, one iterator return. Frozen arithmetic
predicts failure at fourth-filter token11 (16317 accepted,16575 attempted).
Sorting occurs only after full listing exhaustion, so a per-entry reset followed
by sorting cannot satisfy that trace. Sort requires all64 names exhausted, no
child stat, and static proof of1025 byte-span reservation per name comparison:
3141 accepted, fourth admission4166>4096. Second dirsfirst accounting is static,
not dynamically exercised under the low cap. These are proof premises pending
the separate leaf, not product execution results or per-instruction counters.

## Pure checks, no product children

```sh
node --test tests/commands/filesystem-inspection-stress/harness-review/safety-v2/selfcheck.test.mjs
node tests/commands/filesystem-inspection-stress/harness-review/safety-v2/validate.mjs
node tests/commands/filesystem-inspection-stress/harness-review/safety-v2/run.mjs --check
```

Saved selfchecks:7/7 pass, finite pure mocks/provenance/arithmetic only. DP14 and
sort13 altered-report negatives reject; three positive diagnostic spellings and
ten diagnostic negatives are checked. Two positive phase replies use synthetic
Shell reports with the actual fixture telemetry, not actual Shell execution.
Original evidence validation re-evaluates saved bytes without rerunning product.
The inherited `presealSha256` preparation field denotes the derived SEAL here;
the original PRESEAL identity remains separately recorded without modification.

## Execution remains closed

`root-review-proposal.json` has PENDING_ROOT and both proof statuses
PENDING_INDEPENDENT_REVIEW. Its positive proof fields are candidate premises,
not a completed review. The next proof leaf must supply its report path/hash
and approve/correct the premises; root then provides a separately hashed
`ROOT_TWO_ROW_CORRECTION_EXECUTION_AUTHORIZED` document. No such document or
execution claim was created. A hash alone cannot bypass the pending marker.

For later authorization only, the controller interface is the same `--execute
ABSOLUTE_APPROVED_JSON APPROVAL_SHA256 FRESH_TMP_OUTPUT`. The two-row seal,
explicit case list, parent max2-child assertion and one-command child assertion
exclude all four already-run rows. A fixed exclusive /tmp claim before fork
prevents retries under another output path. Root approval also binds the exact
four-start original summary and maximum total6. The original two invalidated
proofs stay invalidated in the base document; no hidden mutation enables them.

Limits remain5s child,30s batch,128MiB heap,256MiB observed-RSS stop,64KiB combined
capture, one concurrent child, zero retries. No new product worker/session API
or cleanup contract was introduced. Snapshot-only loading/forbidden product
host imports remain; the loader additionally admits the sealed sibling v1
helpers required for reuse. Proof/evidence copies contain no compiler or engine.

No commit this turn. Root review, separate proof and explicit execution approval
remain mandatory; neither seven mock checks nor four reused passes approves the
derived rows or establishes a full safety/full38/full40 gate.
