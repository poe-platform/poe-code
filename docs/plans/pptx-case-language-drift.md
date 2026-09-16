# Presentation case language drift reconciliation

Scope: a separate documentation correction on main, without product code,
README changes, corpus access, reference execution, pipeline execution, push or
release. Preserve existing unrelated edits and untracked inputs.

## Agent procedure

1. Compare the API audit's current-status statements with the existing public API
   and command registers. Verify that concrete proposed declarations/schemas
   exist while compiled exports, executable schemas and product tests do not.
2. Compare the recorded source unit conversion examples with J05 and the shared
   rounding contract. Keep source results as historical evidence and state the
   exact differing TypeScript expectations, without changing the shared spec.
3. Read the source paragraph feature and its step definitions. Distinguish
   AttributeError on source primitives from failures in actual model getters.
   Record TypeScript narrowing and native JS null/number property semantics;
   never promise an SDK error code for a native primitive operation.
4. Update the audit and language notes. Refresh only the ledger's current-evidence
   hashes; keep historical input hashes intact. The earlier audit bytes are
   available in local commit dfb4530bb, which predates this correction.
5. Verify the source/test pointers, all updated number/error claims and local
   Markdown links. Run the maintained scoped Prettier formatter/check and
   git diff --check. Recheck the ledger's current and historical hashes and
   unchanged identity/API references after the metadata change.
6. Stage only the audit, language notes, ledger hash update and this plan. Commit
   this correction independently; report its local hash without pushing or
   releasing. No product test, screenshot or spec-version promotion applies.

## Findings

The API audit still called concrete declarations and operation schemas future
API-definition work, although both later design registers already existed. It
now links those designs and retains implementation and acceptance as open work.

The ledger's original cases make three numeric differences concrete: 12.5
centipoints rounds to 1,588 EMU; 2.53 cm rounds to 910,800; 9,144.9 EMU rounds to
9,145. The source expectations are 1,587, 910,799 and 9,144. This is an explicit
contract difference, not an implementation fix or a source-conformance pass.

Paragraph line spacing is a Length, number or null. A source AttributeError from
asking a primitive for .pt is not a model PropertyAccessError. Typed callers
narrow first. Ordinary JS number property lookup yields undefined; null access
throws native TypeError. Neither supplies an SDK stable code. This correction
keeps model-property errors separate from language mechanics without hiding a
public API or introducing extra runtime wrappers.

## Check results

Passed: maintained scoped Prettier check and git diff --check; all ledger
identity/API references; all 71 source-file and 2,450 source-span hashes; updated
current evidence hashes and historical audit bytes at dfb4530bb; exact positive
rounding examples; native JS null/number property behavior; source paragraph
step evidence; target line_spacing union type; and local design-register links.
No product tests or reference suite executions are claimed. The local commit
identity is reported after commit; no push or release follows.
