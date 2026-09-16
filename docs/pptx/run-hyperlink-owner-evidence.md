# Live slide-run hyperlinks

`Run.hyperlink` now reaches the existing `Hyperlink` implementation from ordinary
live slide-shape and placeholder text frames. It supports inert URL reads, writes
and null/empty removal, with the existing relationship reuse and action-safety
rules. This is a bounded owner integration: table-cell, chart-title and notes run
owners remain unsupported and must not be counted as covered public owners.

The current shared presentation state backs an internal synchronous link session.
Its index cache is invalidated when changed/deleted part identities change.
Mutations invoke the existing `prepareChange` relationship editor, validate its
candidate graph before installing changes, and increment the presentation revision.
The internal session has no save method, so it cannot bypass the presentation
owner's deferred workbook flush.
The existing asynchronous standalone session and command entrypoints remain valid.
Internal WeakMap capabilities propagate through shape/text-frame/paragraph owners.
Each hyperlink operation resolves the current full path after validating its run's
generation; stale cached links cannot bind to replacement content.

`run-hyperlink-owner.test.ts` first failed two original cases for the missing
property. Five final cases passed, including shared relationship reuse, live font
edits, save/reopen, null removal, active-URL rejection without mutation, stale-run
errors, a later added slide, a typed detached-owner PropertyAccessError, and `links set --path ... --url ... --in-place --json`
through the public command engine with memfs publication. The same core editor
serves the CLI and model property. Existing action/model/command tests plus the new
file passed **83 cases** before the detached-owner test addition; the final focused file passed **5 cases**. The public-export guide suite also executes the owner
property successfully. Focused ESLint passed for all edited hyperlink/model/text
files. Final maintained package checks belong to the root delivery receipt.

The guide's assignment maps to synchronous JavaScript property assignment. URL
strings remain inert; no fetch, file launch or process invocation occurs. Null and
empty text remove an existing link. The run getter lazily ensures run properties,
while CLI reads remain noncreating queries. The `Hyperlink` implementation accepts
an internal lazy owner resolver so the same cached handle can validate current
ownership after other edits. No source-runtime internals, copied fixtures or
upstream project identifiers occur in product/test files.

A link mutation initially reproduced the same namespace-admission issue as font
fills: standalone prefixed hyperlink markup lacked a default binding under an
inherited one. The existing authored fragment now preserves the escaped parent's
default namespace, without relaxing XML admission.
