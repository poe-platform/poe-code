# Independent approved-fixture verification — August 27, 2026

**The exact approved test-only migration passes this scoped review. The complete
user output policy remains BLOCKED; production changes were not authorized.**

Independent delegated leaf; no redelegation. This verifier writes only this new
directory. Production, package/export files, old fixtures, old evidence and the
author's new evidence remain read-only. All commits use explicit owned paths.

## Immutable authority and source qualification

- Approved test change: `35db31aab5be6a6d98c8ba7f006f714fa1c5da13`.
- Original parent: `6f2f0abb0fb337715849adf8978d5429d086fb6d`.
- Actual replay composition: `592c864ef62f5a29b1f126c83b6ac532357fb599`.
- Final author evidence: `9fb0e32c015e3597565e60b89b6f02e32188cd45`.
- Independent negative-control freeze: `7f4f187b`; committed before replays.
- Separate output-policy proof: `064f3381edd14669528d15c89c71284a0f24694c`.

Both original and revised archives independently authenticate all **333 selected
Git file blobs** and retain their full **387-entry** inventories, including
directories. Selection: `src`, `tests/commands/expr`, `tests/commands/expr-author`,
`package.json`, `package-lock.json`, `tsconfig.json`, `tsconfig.build.json`.
There are no selected-input changes between the approved test commit and actual
replay composition. This is not a bare historical source-hash qualification or
a claim about all current repository tests. No live product overlay is used.

The exact source index SHA256 is
`4fd60b3b2fec4126e42e492922004e90e870a08aa319d2f088c085255355841d`.
`final-audit-02/source-qualification.json` binds that reference, six other
relevant source hashes, actual Git blobs, the separate proof commit, and the
post-replay HEAD inspected there. All seven hashes match the separate proof.
Selected committed inputs were still identical at that audit; unrelated live
edits never enter or veto the committed archive.

## Exact test migration

The approved commit changes only `tests/commands/expr/contracts.test.ts`.
Its entire new body equals its entire prior body with exactly the frozen
assertion replacement. Original argv, environment, loop and controls are
unchanged; only the length iteration's expected result becomes status0,
stdout `3\n` (hex `330a`), empty stderr. The named-collation branch retains
its exact status2/diagnostic assertion. Both bodies and the exact patch are
preserved as data in `run-01`.

| Replay or control | Observed result |
| --- | --- |
| Historical original raw result | 240/241, preserved verbatim |
| Fresh isolated original eight-file cohort | **240/241**, expected scalar-assertion failure |
| Fresh isolated revised same eight files | **241/241** |
| Independent frozen profile controls | **11/11** |
| Frozen structural/inventory negative mutations | **10/10 rejected** |
| Original runtime expectations | **11/12**, `syntax-output-one` remains RED |
| Revised runtime expectations | **12/12**, exact single-row acceptance change |
| Original and revised strict builds | PASS; compiled product inventories identical |
| Focused strict types | PASS; contracts and named-profile tests plus imported source |

The 241-test invocations retain the exact historical argument list. The original
failure is the unchanged named-locale length assertion, with actual0 versus
expected2. Revised success is a separately executed result, not an inferred
241/241 or rewrite of historical 240/241. Both have zero skips, cancellations
and TODOs. Raw status/stdout/stderr and child process receipts are preserved.

The unchanged canonical native tests execute their existing hash-pinned GNU
coreutils 9.7 oracle on **Darwin arm64, Node v22.22.2**. Its executable SHA256 is
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
There are **no new native captures or oracle inputs**, only the existing tests'
bounded calls and test-runner results. Their documented unsupported nullable
backreference cases remain unsupported, not native parity passes. These runs
do not establish GNU/Linux semantics, global parity, or a full gate.

## Independent controls and exact twelve inputs

Before any replay, the freeze fixed negative mutations for changed argv,
environment, named-collation assertion, unrepresentable control, second runtime
row, runtime argv/limit, and new/changed archive files or directories. All ten
are rejected before product replay. Inventory mutations use owned temporary
files, not production or old evidence.

Independent direct-command probes retain unknown locale/alias, named collation,
named bracket, NUL and both lone-surrogate failures. ASCII and Unicode scalar
length return exact `3\n`. A named Unicode match returns `3\n` using one worker;
the other probes start none. Dynamic main-thread RegExp traps record zero calls;
the direct probe's import trace contains no match compiler/worker module in the
main thread. The unchanged canonical worker-only compiler refusal test also
passes. This is scoped evidence, not a universal regex/sandbox claim.

The new author fixture is deeply equal to the frozen twelve-input JSON after
only changing `syntax-output-one.expectedStatus` and `.expectedStderr`:
status **2 → 3**, normal syntax **44 bytes → fixed emergency 34 bytes**.
Argv stays `["1","x"]`, `maxOutputBytes` stays **1**, and every other field of
all twelve inputs is unchanged. The historical driver is byte-authenticated.
This verifier executes each input once in a separate bounded child against the
revised archive and independently scores the same actual tuple under both old
and revised expectations. Thus the two scores do not conceal execution changes.
The author's distinct sequential old/new executions are separately authenticated,
not substituted for these per-input independent executions.

## Output policy is not satisfied

**12/12 does not establish the complete user output contract.** Every normal
write must obey its normal quota; only one fixed, separate, awaited emergency
diagnostic may exceed it. The unchecked catch write in `src/commands/expr/index.ts`
still permits ordinary diagnostics to bypass that quota.

The other proof leaf owns the broader audit, which this verifier did not repeat.
Its committed run02 reports **36/47**, preserving eleven failures. In particular,
`["1","/","0"]` at cap1 returns status2 and normal
`expr: division by zero\n` — **23 bytes**, not the fixed emergency. The committed
proof tuple and source identity are authenticated in
`final-audit-02/separate-policy-proof.json`.

The author's final receipt and all 36 committed evidence files are authenticated
against `9fb0e32c`, with added-file/directory detection. Its REPORT explicitly
flags the actual quota bypass, at-most-once limitations and blocked policy.
It correctly makes no author 241-case claim; the new 241/241 belongs only to this
independent replay. The original and current issue receipts are both preserved:
the proof leaf appended runtime confirmation after the author's original copy.

## Integrity, failures, cleanup and use

Both archive trees and compiled trees match before/after inventories, detecting
new entries as well as changed/missing bytes. The four named historical trees
and selected development-tool packages also match full before/after inventories;
the oracle hash is unchanged. Author evidence and its manifest are independently
checked against the final commit and unchanged after inspection. These are
explicit scopes, not an append-proof assertion about the whole live workspace.

`ATTEMPTS.md` preserves locator/shell setup mistakes. The first final audit
failed because it assumed the mutable temporary issue receipt still equaled
the author's original; its exact driver, failure and receipt remain under
`final-audit`. The successful `final-audit-02` records exact original-prefix
identity and the appendix, while binding authority to committed proof results.
No failed setup or expected product/cohort failure was discarded or rebaselined.

All replay/audit children exited normally. Independent probes report zero
active workers at settlement and after cleanup; no safety termination was
needed. Only owned `run-01/.work` was removed. Other workers, native scratch,
shared dist, staging and source remain untouched. Replay interval:
**20:19:51.159–20:20:19.965 UTC, August 27, 2026**; no 72-hour claim.

`FILE-MANIFEST.json` seals this evidence set, not output-policy acceptance.
Read-only validation: `node tests/commands/expr-stress/approved-profile-fixtures-independent-20260827/verify.mjs`.
The opt-in replay refuses existing run directories and requires an explicit
40-character commit: `node tests/commands/expr-stress/approved-profile-fixtures-independent-20260827/replay.mjs --capture run-next COMMIT`.
Future captures are new evidence, not additions to the existing sealed set.
