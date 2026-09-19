# Hosted Python object I/O qualification

## Objective

Complete issue #781 with actual Python phase/syscall/backend measurements,
exact-byte readback, bounded storage profiles, and independently qualified
Miniflare and hosted Cloudflare Worker runs. Local synthetic throughput alone
does not satisfy hosted acceptance. Change storage defaults only if measurements
justify an improvement without weakening descriptor semantics.

## Hosted resource lifecycle

- Authenticate every exported module by its exact size and SHA-256; reject
  duplicate names, traversal, unsupported module types, and oversized artifacts.
- Deploy only a fresh run-owned Worker and R2 bucket after absent-resource
  preflight. Never reuse consumer preview or production resources.
- Bind the scratch bucket explicitly, protect endpoints with an invocation
  secret, and expire qualification access after one hour.
- Keep credentials out of output and receipts. Forward deployment credentials
  through GitHub workflow secrets; never materialize them in repository files.
- Drain the canonical response before collecting final metrics and independently
  validate byte hashes. Do not retry a benchmark merely because polling expires.
- On success or failure, authenticate Worker ownership, drain scratch objects,
  confirm emptiness, recheck ownership, then delete only the fresh resources.
  Preserve resources if ownership or deletion safety cannot be established.
- Verify the actual `SCRATCH` R2 binding targets the freshly created bucket both
  before cleanup and before deleting resources; an unchanged owner string is
  insufficient authority if the binding has changed.
- Diagnose API access with read-only probes before installing native tooling.
  Report only resource kind, numeric HTTP status, and bounded numeric Cloudflare
  error codes, never account paths or upstream error bodies. Non-404 responses
  remain refusals until genuine resource-absence semantics are established.
- Validate canonical stream reads against the actual number of decoded chunk
  records plus the terminal EOF read. BYOB is allowed to return less than the
  requested 64 KiB; fixed-size read-count assumptions cannot gate hosted success.

## Implementation and validation

1. Add memory-only failing lifecycle tests, then implement the hosted artifact
   admission and resource runner in safe-fs integration tooling.
2. Add the authenticated exported Worker protocol and module manifest from the
   independently passing native benchmark; keep final metrics after body drain.
3. Connect the hosted command and pinned GitHub workflow to that artifact.
4. Run actual hosted matrix comparisons and record credential-free receipts,
   final cleanup evidence, exact hashes, and observed memory/request tradeoffs.
5. Push atomic improvements directly to main while release builds run; close
   #781 only after its full native and hosted acceptance is independently proven.

Focused lifecycle tests must include partial upload failure, primary plus cleanup
failure, failed drain verification, changed ownership during drain, and refusal
to overwrite existing resources. Workflow changes use actionlint, not unit tests.
