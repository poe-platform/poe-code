# Independent successor policy/interface review — 2026-08-28

**SOURCE/DATA findings for root synthesis; not PREEXECUTION_ACCEPTED, not GO.**
No engine imports, executor children, staging, grants, C11, cohort, native oracle,
private package, network, installation, timing or XAN execution. The separate
composed runtime reviewer owns dynamic qualification. Current applicable rules
were read; archived instruction members were neither opened nor copied.

## Exact authority and evidence

- Candidate `230ed3c6e15617b312760367adf9ede4e5c7ff6a`; handoff evidence
  `fedfca3c445696a19aaf84ac85bc74cff229d5c2`, not incidental HEAD.
- SEAL: 82608 bytes, SHA256
  `05aa8dce295c507fd605c93aa113ba2ecd5605064dc0f6dfe3a20aa6dc6bf04d`.
  INTERFACE: 8796 bytes, SHA256
  `913d051875c60492cce06937ff33b85bb4c9b36085b79169d5e51e87852880c4`.
- BEFORE/AFTER authenticate **322/322** bound bodies, sizes and filesystem modes:
  313 exact candidate Git blobs, seven historical materialized files bound by
  the committed seal rather than individual Git blobs, two external tool files.
  The seven include old child-003/RESULT/stdout, the consumer and three comparator
  source files. They are prerequisites, not reproducible merely by checkout.
  No archive-member regeneration or original source-policy tests were performed.
- All 322 bindings and both declared namespace censuses (28 and 30 entries) are
  stable before/after. Namespace checks detect added entries except excluded
  `runs` descendants; this is not append-proof coverage of the entire repository.
  Git mode records only executable/non-executable; exact 0444/0644 is verified
  against the sealed filesystem-mode contract, not inferred from Git mode.
- Existing TypeScript 5.9.3 parsed 135 harness MJS files as data. The seeded
  admission static relative-import closure has 48 members and zero missing edges.
  Dynamic engine/loader edges are not certified by this syntax scan.
- Preserve failures: initial checker stopped on its incorrect all-Git assumption;
  completed BEFORE is **480/481**, AFTER **483/484** data assertions, each retaining
  the historical closure failure below. Neither is a runtime score or all-pass.
  ATTEMPTS.md preserves the correction and oversized metadata scratch disposition.

## Actionable static findings / readiness blockers

Paths below are relative to `tests/comparison/breadth-continuation-20260828/`.

1. **AUTH commit type is coerced.** `executor-v7-r1/authorization.mjs:21` checks
   commit with a regex but no primitive-string predicate; `:57` repeats it.
   A one-element JSON array containing a 40-hex string satisfies the regex and
   interpolates to that same Git commit. This is a concrete strict-type defect,
   not an arbitrary-code or unauthorized-commit bypass. Require a primitive
   string before regex/interpolation at both boundaries. Partner should verify
   array/object/nonstring rejection; no such dynamic test was run here.
2. **Terminal child disposition types are incomplete.**
   `executor-v7/report.mjs:91` validates the two exact keys, then only compares
   exit and close values for equality. Equal string/boolean values can pass that
   predicate; it does not require nullable integer code / nullable string signal.
   Validate finite own-data types and role-specific dispositions. Do not require
   every child to exit zero: deliberate negative controls have other outcomes.
   Reachable source defect; partner must establish whole-assessor consequences.
3. **Final-report and authority-observer binding is incomplete.**
   `executor-v7/report.mjs:81` authenticates captured transport bytes and sequence/
   final-envelope presence, but never validates or reconciles final.report's seven
   fields, notably integer children, against terminal children/accounting/result.
   At `:100`, authorizationMetadata permits an empty array, merely checks a subset
   of each row, and does not require the two actual coordinator Git loads or exact
   PID/hash/size types. Root must resolve the observer contract; partner should
   challenge these cases in its own composed review. This does not allege that
   the real coordinator emitted malformed data or prove an admission bypass.
4. **Whole-seal static closure is not complete.** Sealed historical
   `coordinator-report-v1/publisher.mjs:3` imports unbound `./records.mjs`.
   The edge is outside the 48-member active admission closure; not shown to block
   this launcher. Keep this failure and qualify any claim of whole-seal closure;
   do not silently turn it into an active-engine defect or repair unrelated history.
5. **Independent composed runtime evidence remains required.** In particular,
   a fresh successor B16 actual CLI observation is not supplied by the author's
   post-capture reconciliation. Partner must independently cover the intended
   boundary, integrated readers/authority/body/publication and caught late getter
   violations before a root readiness decision. No inherited dynamic B16 credit.

## Policy integration: source findings, not execution

The prior f97477ac report was read, not rerun. The integrated profile retains its
narrow unavailable-feature meaning. `executor-v7-r1/bootstrap.mjs:27` binds all
three named sources to exact size/hash and **0444**; the 58-byte consumer remains
0644. `worker.mjs:51` installs offline denial, authenticates route/source, and
opens only around consumer import. Exact primitive `module`, then `worker_threads`,
one argument each, return undefined; no native getter is captured or delegated.
Consumption precedes observer callbacks, slot two revokes immediately, and the
same captured detached function consults permanent revocation. Reentrant/observer
failures poison qualification. Import finally revokes and restores ordinary denial
on success and rejection; successful import qualifies before export/factory/setup.
Caught import-time violations fail qualification; final close catches later ones.
Primary thrown reasons are retained through the import wrapper, including null/
undefined, with explicit presence and separate cleanup information.

The existing `executor-v3/offline.mjs` Module/createRequire guards and
`executor-v6/loader.mjs` remain authenticated inherited bodies. Other Module
imports are not universally denied. This gate is neither caller authentication
nor stock-Node capability equivalence; detached aliases are intentionally valid
only during the ordered window. Source reasoning does not certify asynchronous
runtime ordering, factory behavior or host-JavaScript isolation.

## Readers, body, and role distinctions

`executor-v7/records.mjs:118` is actually reached through the successor bridge.
It binds regular non-symlink record mode/size/hash, opened inode/device/size, EOF,
canonical ordered part names, exact part lengths, whole-document length/hash and
ceil(bytes/262144) count, at most 128 parts for 32 MiB. Writers share an evidence
budget; body claims/lock/config and staged declarations enroll before writes.
Multipart envelope/part objects do not enforce closed key sets; do not describe
these metadata readers as general exact-schema validators. AUTH is bounded to
65536 bytes/0644 and exact two/three-key own-data objects, except finding 1.
Whole-body cleanup precedes final publication; outer acceptance requires natural
exit/close zero, no signals/failures/truncation, and authenticated result data.

The 12-field supervisor receipt is not the 12-field BOUNDED_TERMINAL_V2 object.
Terminal children is a dense array (max 99), seven keys per child; final FD3 report
has seven keys and **integer** children. Counts have three own numeric fields;
launchAccounting has seven fields. Primary has two fields; result reference four.
The shared own-data helpers reject holes/accessors/extras without relying on
realm prototype identity. Finding 2 and 3 identify incomplete nested use, not a
reason to weaken this rule. See UNEXECUTED-TEMPLATE.md for limits and authority.

## Preserved historical denominators

Author original d180c3e4 remains **31/33**, two harness failures, 28 children
reaped. Focused correction remains **2/2 + 12 negative controls**, zero children:
G08 corrects 0444; B16 distinguishes integer count from array in authenticated
old captured data. It is not replay, original 33/33, or current composed proof.

Old becd1647 remains UNSAFE_STOP: V6 3/14 workers, zero C11/semantics; stdout
359581 observed / 65536 retained / **294045 irrecoverable**. RESULT 531954 bytes
and four other oversized artifacts remain noncompliant; no retroactive relabeling.
V4 grant c1b03b64 is consumed (1/14, zero qualified/C11/semantics). V5 preserves
F1 and its correction; its handoff states no usable V5 grant was issued, not a
fresh authorization or reuse of V4. V6 grant 5ac29fef is consumed. None authorizes
V7-r1. Report-review 19/20 then 18/2 qualifications, operational **13/54 vs 47/54**,
and **W07 UNQUALIFIED/UNCREDITED** remain unchanged. No superiority/full gate claim.
