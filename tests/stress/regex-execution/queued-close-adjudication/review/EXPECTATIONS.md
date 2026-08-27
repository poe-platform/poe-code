# Independent queued-close expectations, frozen before adjudicator findings

Owner: different independent leaf reviewer, this new `review/**` only.
Frozen August 27, 2026, before reading the adjudicator ready note or findings.
No source, canonical test, root/runtime, dependency or public exposure changes.

## Inputs and authority

- Approved contract: `07acb1a4d30b7592cf247a0220250317be4e2038`.
- Current registration source: `01aa1bffe0568cc6787d5ff8e0331e024a787385`.
- Prior independent Phase A: `0b370e33cdb42128c6585cbebd1f6bad02753285`.
- Historical client SHA256 at contract commit:
  `6745088269d2c9be612cbb55e612fb73d960d1b0df6c02d91e1b8f431f2ef1b9`.
- Current client SHA256:
  `1638d492d11d466875b98451a59bace4e60e71fcd5468d671182187549922bca`.
- Approved command.md SHA256:
  `8a5426b1e7a30a03dc62f74b28c6eb7bf9b008b78cb7b521eb7de0bc5c59a3f8`.
- Exact historical `followup/messageerror.test.ts` SHA256:
  `29b38d1603829e8f914410463b0537752aa585444a990e204b96948b92d14214`.
- Read cleanup-registration/REPORT.md and cleanup-boundary-review/REPORT.md.
  Initial live HEAD was `90c1a3cb04a6a01e456544cbac747b327a8dfb1d`;
  live client/protocol match the specified source, but live runtime is not input.

## Independent expected behavior

1. Normative admission includes already admitted work capable of creating a
   worker later. Callback cleanup permanently closes that acquisition admission
   and releases invocation requests/leases without draining opaque host work.
   Historical session.close only waited for pending requests; that explains the
   old second-worker expectation, but does not establish its continued validity.
   The new callback delegates to session.close. In the exact retained ordering,
   capacity stays occupied by a gated idle retirement until after close begins.
   Acquiring a replacement for that closed queued session afterward conflicts
   with closed acquisition admission. Initial assessment: that expectation is
   obsolete for this contract, conditional on cancellation/cleanup controls.
2. Unaborted queued close rejects its pending request with RegexExecutionError
   code CLOSED, not success, PROTOCOL, WORKER_ERROR or an invented caller abort.
   The idle worker's messageerror is not the queued invocation's request error.
   Independent closed-run calls need not share the same newly constructed Error.
   Caller abort already selected before close preserves its exact reason, even
   an errno-shaped object or falsy primitive; never classify by error shape.
3. Internal request selection and outer caller precedence are distinct. An
   already selected PROTOCOL (or CLOSED) rejection is not rewritten by a caller
   abort that occurs during retirement. withRegexSession/public contract must
   instead prefer the exact caller reason observed before outer settlement.
   Without caller abort the established execution error retains its identity.
4. Queued request rejection may settle before unrelated idle retirement. In the
   retained two-session ordering first.close releases one handle; second.close
   is last and must remain pending until that idle retirement completes.
   Repeated close returns the same completion promise. Closed admission is
   synchronous; late run/acquisition is rejected, before and after retirement.
5. Duplicate idle messageerror must cause exactly one terminate, retain capacity
   until termination completes, and remove every installed transport listener.
   A positive unclosed queued-session control must acquire a replacement only
   after that gate, preserving coverage of queue progress and held capacity.
6. Closing a queued session while a sibling owns an active lease must neither
   terminate the sibling nor await global worker zero. The sibling must still
   complete its exact benign response. Final cleanup must retire every fake
   transport exactly once, with no dangling observed listeners/requests.
7. Direct executor run rejects; it has no command exit-status field. This test
   cannot establish grep/rg status2 or Shell cancellation/pipe status. Existing
   utility mappings and normative public precedence remain separately scoped.

## Bounded verification and disposition

Use only existing local TypeScript tooling, frozen client/protocol, benign fixed
single-byte rows, fake transports and strict unhandled rejections. No real worker
matching, risky probe, original-five replay, broad gate or runtime acceptance.
Check exact-child exit/stdio closure with a bounded watchdog. Freeze this file in
an atomic owned-only commit before executing controls or inspecting new findings.
Then critically inspect the separate proposal: a test-only migration must retain
retirement, capacity, duplicate-event, error and sibling controls, not merely
replace workers2 with workers1. No canonical mutation is authorized here.

Preserve historical99/100, originalfive0/5, and110/111 as historical failures,
not new passes. Runtime still awaits explicit USER/root-relayed Sagan commit;
livegit does not authorize a handoff. If adjudication is unavailable, publish
the initial assessment at the requested /tmp marker and wait only boundedly.
