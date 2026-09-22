# htmlq engine review and remaining qualification

Scope: `engine-htmlq`, reviewed on 2026-09-20. The private engine and public
subpath already existed in the working tree before this review. Preserve those
files and the unrelated workspace/publication edits; this review does not claim
authorship of that implementation.

Five original memory-stream tests failed before the corresponding repairs:

- Discard unfinished start/end tags at EOF instead of creating DOM elements.
- Preserve foreign literal NUL as replacement text; replace markup NULs and
  retain the question mark in HTML bogus comments.
- Ignore empty end tags and recover EOF in the end-tag-open state as text.
- Preserve source and cleanup failures together, including falsey failures.
- Enforce document-edge depth for implied nodes and template fragments.

Source and cleanup failures are observable in an `AggregateError` with the
original failure first. Successful source exhaustion does not invoke `return`.
Cancellation still races pending reads and awaits exactly one cleanup attempt.
External producers must cooperate with cancellation and provide prompt cleanup;
the engine cannot force an arbitrary producer's `return` promise to settle.

The change adds no runtime dependencies, host filesystem/executable/network
access, proxy functions or parser-engine duplication. Frozen DOM views and
live detach relationships remain intact. Original mode retains decoded source
and rejects detached mutations. No persisted snapshot format or version changes.

Verification after repairs:

- All 33 package engine tests pass, including existing adoption, foster
  parenting, template, raw-text, namespaces and BOM chunk-boundary controls.
- Package lint and source/test typechecks pass.
- Maintained explicit htmlq and safe-bash workspace build closures pass.
- The maintained safe-library packer generates the artifact successfully.
- Public htmlq runtime and strict declaration fixtures pass in a consumer that
  contains only links to the three generated public artifacts. This is generated
  artifact consumption, not a registry install or publication qualification.

## Unresolved qualification; completion remains blocked

`htmlqBaseline.fullHtml5Parity` remains false. The existing parser documentation
explicitly states that complete insertion modes, scope rules, script/comment
states and malformed-markup recovery have not been qualified. The focused
controls do not establish the full html5ever grammar or recovery contract.
Do not mark the full requested HTML5 engine complete based on these passes.

Remaining work must establish independent failing controls for the unqualified
insertion modes and scope/recovery rules, repair each validated discrepancy with
TDD, and rerun the affected engine and public-artifact checks. Keep selectors,
pretty output, URL rewriting and command adapters in their subsequent plan
tasks. Do not silently expose modern selector extensions or substitute a
snapshot mutation traversal.

No commit, push, release or private-package publication was performed here.
