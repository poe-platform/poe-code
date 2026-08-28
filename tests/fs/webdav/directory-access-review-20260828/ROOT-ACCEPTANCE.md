# Root policy acceptance; production implementation remains held

Recorded August28,2026. Root explicitly approved D1–D4 in
`6bd3a0d98d3043c14ed0fa80dedb36b72b65d9e5` without changes.
This record does not authorize implementation before the independent freeze
returns and root gives the subsequent go-ahead.

## Approved policy

1. **Virtual navigation only.** A fresh, namespace-bound successful collection
   stat permits directory X_OK as a logical-cwd navigation policy. Keep
   `permissions:false`. Do not infer POSIX search/execute permission, remote ACL
   grants, listing/child/content access or future access. No new capability,
   credential discovery, network authorization or identity assertion.
2. **Mode combinations.** Directory mode1 is the metadata-backed navigation
   check. Mode5 additionally requires the existing depth-one directory listing
   check. Non-directory X_OK remains ENOTSUP. Provider write-containing modes
   remain ENOTSUP; readonly-wrapper EROFS behavior remains unchanged.
3. **Cancellation and errors.** Validate mode0..7 first. An already-aborted
   caller with a valid mode receives typed ECANCELED before admission. Recheck
   after awaited phases and before success. Retain the existing typed active
   cancellation, deadline and cleanup behavior. This does not change readonly's
   existing local write rejection into a provider-wide cancellation guarantee,
   promise raw abort-reason rejection, or preempt arbitrary host work.
4. **Private bounds.** Only newly supported X-bearing modes1/5 receive the
   64KiB UTF8 path and256 nonempty input-component caps, checked incrementally
   before normalization/splitting/provider work. Exceeding either returns
   ENAMETOOLONG. Existing response/entry/request-time limits remain; no aggregate
   deadline, new public limit, global work counter or unrelated mode change.

Denied, missing, non-directory, malformed and unknown metadata retain the
approved precise status/error mapping in `POLICY-PROPOSAL.md`. Do not replace
required-property failures with success, infer permissions from synthetic modes,
relax href/redirect confinement, or silently widen the existing resource-type
profile. Later operations continue to enforce their actual server boundary.

## Ownership and release gates

- Locke owns `tests/fs/webdav/directory-access-independent-20260828/**` and is
  freezing precode cases. This author neither edits those inputs nor claims the
  freeze has returned or execution has occurred.
- Production remains held until root's explicit subsequent authorization. The
  anticipated author scope is narrowly `src/fs/webdav/webdav.ts` access/private
  validation, scoped WebDAV documentation and author provider tests.
- Public/scoped documentation must state the limited virtual-navigation meaning,
  lack of ACL/listing/child/future guarantees, modes, bounds and cancellation
  behavior. Provider README edits wait for source authorization; this acceptance
  record is the only new documentation at this checkpoint.
- No runtime, shell state, parser, directory-stack, contracts, other providers,
  readonly implementation, root exports, package or capability changes.
- A later source candidate needs different review before the separate cd
  prerequisite can resume. Policy approval is not source acceptance.

## Preserved observations and current state

Precode freeze: `603ba3371736373316e419c2327bc68c4d96dba9`.
Design/evidence: `6bd3a0d98d3043c14ed0fa80dedb36b72b65d9e5`.
The30 baseline profiles,41 outcomes and35 injected protocol requests remain
immutable **observations**, not positive coverage of implemented directory X_OK.
Existing plain/readonly cd success and X_OK ENOTSUP remain as captured.
No baseline reclassification, native/real-service rerun or additional provider
execution accompanies this acceptance record.

The prior cd28 observations, directory-stack0/34 history and independent
component evidence remain unchanged. At this checkpoint, WebDAV production and
`src/shell/runtime.ts` still match accepted5137. No source candidate, active test
child, server, new dependency or temporary service resource is created here.
