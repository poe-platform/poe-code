# Independent source inspection: ca1d on accepted5137

Inspected exact committed diff and surrounding accepted provider contracts, not
moving HEAD as an execution candidate. Candidate provider SHA256:
`cf65b82429bd92ca52b73490e1d6c1070545b5912fbddaba7037e01c57cc21f5`.
Candidate provider README SHA256:
`b931ac0545c709d3be2bd7d8e328fe9b1137cdb6514dfd8e9975c64c1fecb7bd`.
All referenced line numbers are in ca1d33424b94a21ae0f40a36412fd8191611e2df,
not the live file. Full selected source/composed-tree proof is archived.

## Inspection findings

- webdav.ts95–113: private raw scanner counts UTF-8 code points (including four
  bytes for surrogate pairs), raw nonempty slash components and early limits.
  It advances past the second UTF-16 code unit of a valid pair. Literal dot/dotdot
  components count before normalization; repeated separators do not. Limits are
  inclusive65,536/256 and error is typed ENAMETOOLONG. Short malformed strings
  still reach existing normalization. Mixed malformed/oversize ordering remains
  intentionally outside the frozen acceptance set, not an approved new promise.
- webdav.ts986–989: integer0..7 first, then valid caller preabort, then write
  refusal, then new X-only path scan. No transport precedes those checks. No
  readonly implementation change: its local EROFS exception remains intentional.
- webdav.ts990–992: fresh existing stat on every call, post-await cancellation,
  then non-directory X refusal. No advisory mode or prior-stat cache substitutes
  for this observation. Directory-required suffix semantics remain inside stat.
- webdav.ts993–999: read bit independently requires existing readdir for a
  directory; successful file X modes never reach GET. After the read phase the
  last check prevents fulfilled-await cancellation from becoming success. Two
  directory observations do not establish unchanged identity or a lease.
- webdav.ts196–199: unchanged constructor defaults are maxResponseBytes64MiB,
  maxXmlBytes2MiB, maxEntries10,000 and timeoutMs30,000. The frozen harness normally
  supplies16MiB/2MiB/10,000/500ms, with explicit bounded overrides. Do not call
  those injected values measurement of all constructor defaults or a new global
  budget. The default definitions and complete request/parser helpers are
  preserved by source composition/diff; bounded cap behavior is exercised by L-*.
- Existing namespace parsing, redirect exactness, per-request signal/deadline,
  XML byte ownership and cancellation code are unchanged. Candidate only adds
  the private scanner and access ordering/logic. No transport capability, public
  API, root export, permissions flag, generic FS contract or runtime is changed.
- README explicitly describes logical-cwd policy, no inferred authentication,
  no remote search/ACL/listing/child/future guarantee, mode5 sequencing, caps,
  readonly precedence and non-preemption. It does not advertise permission
  introspection on permissions:false or genuine WebDAV ACL traversal.

No source contradiction or blocking provider defect was identified in this
bounded inspection. This statement does not replace actual frozen-case results,
declare remote-service acceptance or authorize cd/runtime/directory-stack work.

## Invariant interpretation (evidence mapping)

| Frozen invariant | Runtime evidence | Non-runtime limit |
| --- | --- | --- |
| Logical cwd; permissions:false; no capability | Capability assertions every case, N*/G* | Meaning and absence of broader grants require this source/doc review |
| Exact sequential requests, no hidden fallback/mutation | Every admitted method/URL/depth/body/header trace, including Q512 | Injected transport, not an OS network sandbox |
| Typed errors, not raw abort reason | O*/C* and all negative metadata outcomes | No arbitrary host-error provenance inference |
| No cache/lease/ACL/child/future inference | N01/N02 revocation, R-new-collection, G child denial | Lack of remote ACL/ABA/future promises is a design boundary, not a universal empirical proof |
| Per-response/request rather than global budgets | L-independent-budgets and same-signal canonical pairs | Default numerical values source-inspected; no global deadline guarantee |
| Underlying cancellation counts | Every request resources tuple plus C*/redirect bodies | API cancel-call counts are deliberately not equated with producer cancels |
| No opaque-host preemption/await-all promise | Deferred late responses/rejections released after outward failure | Only cooperative finite mocks are drained; arbitrary host work untested |
| Future cd separate | G provider fixtures only | cd runtime and stack execution remain held/design-only |

Final measured statuses are in REPORT.md/RESULT-v3.json; this mapping must not
be summarized as eight independent runtime theorem passes.
