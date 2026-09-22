# command-csvsort review

Status: incomplete; prerequisite acceptance blocks command wiring.

Inspected the current working tree on 2026-09-20. The private ESM workspace
`safe-bash-command-csvsort` exists and has no runtime dependencies. Its three
source files implement and test only `sortRecords`. The public entry exports
that function, `CsvSortError`, and admitted-record types. It does not export a
CommandDefinition, plugin factory, CSV byte-stream SDK or typed invocation result.
The existing README accurately states this limitation.

The safe-bash manifest has no `./commands/csvsort` export, command dependency or
qualified private-workspace build profile. Consequently there is no installed
csvsort runtime/declaration artifact to qualify. Existing build changes for
other command packages were inspected but preserved.

Blocking findings:

- The shared CSV parser, selector, comma/LF serializer and whole-column inference
  contracts required by the command plan have not been accepted. The admitted
  sorter supports text, canonical integers and nulls; it cannot supply Decimal,
  Boolean, duration or civil/date-time inference by itself.
- CLI/SDK argument equivalence, literal VFS paths, awaited sink writes, signal
  forwarding, invocation cleanup and aggregate parser/inference/output budgets
  have no implementation to test.
- Public export wiring and isolated packed runtime/type consumers remain absent.
  Default registration must remain unchanged when this integration is added.

The command plan explicitly requires prerequisite acceptance before dependent
integration. The package pattern is available at
[its archived location](archive/safe-bash-command-package-pattern.md). No held
XAN payload was read, copied or imported, and no placeholder command or reduced
compatibility profile was introduced.

Review of the existing sorter found no proxy-only functions, external runtime
imports, host I/O, network, native fallback or dynamic downloads. Its iterative
merge sort preserves reverse ties, compares text by code points, owns copied
payloads, and checks explicit storage/work/record/key limits and cancellation.
Those observations apply only to admitted records, not CSV compatibility or
invocation lifecycle. No reproduced sorter defect justified changing its code.

Fresh verification passed:

- `npm run test:unit --workspace=safe-bash-command-csvsort`: ten tests, zero
  failures; includes stable reverse ties, null order, exact integers, payload
  ownership, budget boundaries and falsey cancellation reasons.
- `npm run lint --workspace=safe-bash-command-csvsort`: ESLint and source/test
  TypeScript checks passed.

Native QA, CLI screenshots, command cancellation/chunk tests and packed-consumer
checks remain unexecuted because there is no CSV command to exercise. Existing
research observations do not qualify this sorter as a compatible csvsort.
This review adds only this evidence document and preserves other contributors'
files. No local commit, remote-main delivery, release or publication occurred.
The unresolved findings above block completion.
