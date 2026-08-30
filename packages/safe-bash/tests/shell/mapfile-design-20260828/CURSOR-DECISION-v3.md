# Additive ROOT cursor decision, August28,2026

This supersedes only the unresolved causality/queue recommendation in ADDENDUM-v2
and observer-v1/HANDOFF. Their historical bytes/results remain unchanged.
Independent075fbe24/LEASE-OVERLAY is the source of the detailed proposed phases;
only the following ROOT decisions are ratified here, not every proposed status.

- Canonical record acquisition is exclusive and nonreentrant. **Any overlap**
  refuses before additional pull or target effects, including independent siblings.
  No implicit queue or asynchronous-causality/AsyncLocalStorage requirement.
- The lease necessarily spans trusted host next(). Acquisition registration,
  caller cancellation, suffix retention, cleanup and exact reason provenance still
  apply. Bypassing the canonical API is outside this guarantee.
- Invocation-owned raw-input canonicalization remains proposed; no new cursor per
  mapfile call and no global ByteSource cache. Borrowed completion/-n cannot close
  the parent input. Pending opaque next() is distinct from operation-lease lifetime.
- `-u0` means effective shared stdin, including redirection/middleware. Runtime-known
  closed input fails before target changes; opaque producer failures are not
  pre-detectable. Other FDs, -C and -c refuse before builtin pull/target effects.

Busy diagnostic/status, precise precedence against invalid options/readonly targets,
and release-after-child-abort with outstanding opaque next() still need final
product-policy binding and tests. No product source, API, ordinary read behavior,
arrays, shared budget or engine was changed. The observer repairs are independent
of eventual array acceptance; product mapfile remains blocked on that prerequisite.
