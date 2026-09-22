# behavior-csvsort task review

Status: blocked; implementation and all acceptance cells remain open.

Review on 2026-09-20 of HEAD
`35d01c57f8078d8afa916dc59929395d857e9c55` and the current working tree
confirmed the [behavior prerequisite finding](safe-bash-csvsort-behavior-prerequisites.md)
and [engine prerequisite finding](safe-bash-csvsort-engine-prerequisites.md).
Package file and manifest searches found no csvsort workspace, accepted shared
CSV parser/selector/inference engine, public csvsort export or bundler entry.
This is missing implementation, not a reproduced runtime sorting defect.

The command plan requires prerequisite acceptance before dependent integration.
The requested package-pattern document has moved to
[its archived path](archive/safe-bash-command-package-pattern.md); the move was
preserved. That pattern assigns shared parsing to narrowly scoped private
engines. `packages/safe-bash/integration-boundaries.json` holds the XAN CSV,
selector, sort and writer modules. No held implementation was opened, copied
or imported.

Blocking finding: the admitted shared parser, selector, serializer and typed
inference contracts needed for behavior TDD do not exist. Their acceptance must
cover QUOTE_NONNUMERIC float provenance versus Decimal input, versioned parser
profiles, temporal capabilities, owned byte fragments, explicit cancellation,
invocation cleanup and input/decoded/retained/output/work accounting. Existing
plan status labels do not supply executable evidence of those contracts.

After prerequisite acceptance, start independent failing composite-key,
reverse-stability and null-order tests, then quota, chunk, serialization,
cleanup and cancellation cells from the acceptance matrix. Preserve the full
matrix; no smaller supported profile has been approved. Public runtime/type
exports and installed-artifact bundling remain subsequent acceptance work.

There is no task implementation diff to review for abstractions, proxy functions,
duplication, unsafe host access or compatibility regressions. No placeholder
tests, command scaffold, export, manifest, admission-policy or existing status
change was made. Runtime tests, screenshots, native QA and packed consumers
were not run. This review is documentation only and does not qualify behavior.
Local commits, remote-main delivery and successful releases: none. Unrelated
edits were preserved; the private command package was not published.
