---
title: Arguments accessor capture accounting
---

# Validated gap

Memory measurement of arguments objects used data-only argument entries and
omitted string-keyed getter/setter captures. Two tests reproduced a zero-unit
difference between empty and 100-character accessor captures (both failed,
982ms). This is an accounting bug, not evidence that accessor invocation itself
was unsupported.

Capture argument descriptors before traversing values, and retain guest accessor
closures alongside data properties. Do not invoke accessors. Keep the existing
native restricted-callee exclusion, string-key ordering, non-enumerable length
charge, symbol handling and repeated-object deduplication. Do not change copy or
snapshot support policy as part of this fix.

Verify getter and setter captures, budget rejection, deletion/release, mutations
during retained callbacks, regex ticket ownership, existing arguments semantics,
and unchanged camera traces. Run lint/type checks and this actual harness pair;
inspect the screenshot. Commit and push this fix separately and monitor release.

Local verification: 456 tests passed across 20 files (10.13s), including five
focused regression cases. TypeScript and ESLint passed. Existing non-enumerable
arguments-length accounting and complete camera trace assertions are unchanged.
The open-issue search for arguments accessors returned no matching issue.

The actual harness passed after 70 uncached workspace build tasks (71.819s)
and root build stages; its screenshot was inspected. No models were invoked.
Built-SDK camera fixtures still matched in full: 1854/1575/1222ms respectively,
with unchanged steps 11794/11206/9957 and peak data 7161/6550/5939. These local
checks do not establish that the independent CI camera timeout is resolved.
