# csvgrep engine prerequisite finding

Inspected 2026-09-20. `engine-csvgrep` remains unimplemented because the
required accepted shared CSV parser and selector contract is absent.

Workspace-manifest and source-path searches found no shared CSV engine/parser
workspace. Searches of `safe-bash-contracts` and the command workspaces found
no shared CSV parser or selector API. Non-held CSV source candidates are
Pandoc's document-format reader, ExifTool's CSV serializer and OP's value
utilities; none provides the required accepted Safe Bash contract. The existing
csvsort prerequisite finding independently records the same missing dependency.

`packages/safe-bash/integration-boundaries.json` holds XAN's CSV, selector,
writer and command modules. `packages/safe-bash/tsconfig.build.json` excludes
those implementation paths. No held source or evidence was read, imported,
copied or admitted for this task. The requested package-pattern document is
deleted in the working tree; its archived successor at
`docs/plans/archive/safe-bash-command-package-pattern.md` was inspected without
restoring the deleted file. It requires shared parsing in a private engine
owner and an acyclic engines/contracts → commands → safe-bash dependency graph.

The inspected regex contracts are
`packages/safe-bash/src/commands/regex-execution/{public,protocol,provider}.ts`.
They expose explicit worker injection, request/startup timeouts and bounded
queue controls. Their descriptors cover grep, rg, glob, expr-match and
bre-search; no Python 3.9 regex profile is declared. Worker isolation alone
does not establish Python search semantics. Forwarding Python patterns to
these descriptors or native JavaScript RegExp would not satisfy the requested
Unicode categories, anchors, flags and named-reference controls.

To unblock implementation, establish and accept the original shared CSV
parser/selector/serializer contract, or complete the existing admission gates
for reusable source. That contract must expose byte streams, physical parser
line numbers, ordered selectors, versioned decoding/dialect/quoting/NUL
profiles, structured errors, cancellation, cleanup and explicit accounting.
The regex capability must declare its supported Python grammar and semantics,
unsupported errors, compile/search work bounds and worker retirement policy;
it must remain explicitly injected without a command-to-safe-bash dependency.

After acceptance, write original failing tests in
`packages/safe-bash-command-csvgrep` against those APIs before implementation.
Independent controls are already specified in
`docs/plans/safe-bash-csvgrep-acceptance.md`. Initial engine tests must cover
truthy regex/file/literal precedence, omitted empty patterns, all/any/invert,
short fields and preserved short rows, physical multiline numbering, and
Python Unicode rstrip match-set membership. Match-file controls must include
VFS-only access, decoding, byte/line/entry/retained-set budgets, duplicate-input
charges and cancellation. Add grammar/error/every-byte-split tests, producer
reuse, cleanup races and invocation-local exhaustion controls before claiming
compatibility. Unit tests use memory VFS and mocked capabilities; native
executables remain manual QA only.

The command owner must be named `safe-bash-command-csvgrep`, private, TypeScript
ESM and free of external runtime dependencies. Safe Bash only composes and
exports it through `@poe-platform/safe-bash/commands/csvgrep`. Runtime and
declarations must be bundled and tested in an installed public-artifact
consumer without the private workspace. CLI/SDK equivalence and installed
artifact qualification remain open.

No substitute parser, empty package scaffold, placeholder failing test,
runtime export or build-policy change was introduced. No code tests were run
because no code was changed. No compatibility, packed-consumer or publication
pass is claimed. Unrelated edits were preserved. Local commits, remote-main
delivery and successful releases: none.
