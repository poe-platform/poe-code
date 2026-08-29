# ROOT design ratification — ERE transport

Recorded 2026-08-29 from ROOT's explicit design-only ratification of
`56fb11365399cf740f1ae2e65b532d74543fcbb8`. This appendix records approved
choices; it does not rewrite the proposal, historical bindings or unrun matrix.

## Ratified choices

- **Isolation and lifetime:** sibling executor plus static ERE entry; lazily
  acquire one Worker per invocation root. Descendants/jobs share its serialized
  scheduler and ledger. Register cleanup before acquisition; root settlement
  joins retirement. Preserve existing expr protocol and public
  `RegexExecutionOptions`; no inherited loader authority.
- **Wire and engine accounting:** retain the five-field result inside a
  versioned envelope carrying all seven validated usage counters. Exact aliases
  are `steps = usage.work` and
  `allocatedUnits = usage.allocationUnits`. Pattern/subject are high-water
  counters; work, states, allocation, capture bytes and capture slots are
  cumulative spent usage. Reserve before dispatch. Release only proven-unused
  reservation on validated success or semantic failure; never refund spent or
  unknown crash/timeout/malformed usage.
- **Additional parent accounting:** separate private parent transport logical
  storage/work ledgers use the same engine-derived A/W caps. They are ADDITIONAL
  to engine ledgers, not hidden sharing or a physical-memory guarantee. The
  proposed `47+4n+p+s` request and `479` reply/copy/result schema must be
  source-bound and independently validated before execution. Adopt the private
  64-ticket queue maximum; overflow is an explicit private profile limit, not
  an unbounded queue or new public option.
- **Canonical nonmatch and validation:** wire nonmatch has exactly
  `groupCount+1` null spans. Distinguish empty participation `[k,k]` from
  nonparticipation. Eventual runtime `BASH_REMATCH` is empty on valid nonmatch,
  not the wire null array. Reject malformed identity, cardinality, accessors,
  holes, extras, spans and counters before publishing results or refunding
  reservations.

## Binding and authority boundary

The ratified proposal is `DECISIONS-v2.md`, SHA-256
`7827c12eea1e6a4292be5f260b1ccc8f28458aa82df1ab46dae3d360c6ee3e17`;
its existing `CHOICES-BINDINGS-v2.json` remains unchanged (SHA-256
`e7dbf21e6ea9e6e35c0039b5ff1da29a1f7ee12166de32eefa7e5c8cd3a049d9`).
This appendix does not independently ratify other proposal details.

All **32 families / 60 variants remain UNRUN**. Pure engine
`f97fd06024cb63edfd01873d81d84576a22189db` remains pending independent review.
This is SOURCE/DATA documentation publication only: no implementation, real
Worker creation, engine execution, conditional/runtime/publication behavior
changes, or native-parity acceptance is authorized. ROOT will sequence any
implementation after coherent-package priority. Close this task; no follow-on
work without a fresh grant.

