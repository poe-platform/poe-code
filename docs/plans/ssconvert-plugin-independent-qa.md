# Independent ssconvert plugin QA

An agent different from the integration owner reviews the implemented adapter and
stresses it with original small byte fixtures. This procedure covers the safe-bash
binding; it does not certify complete Gnumeric conversion compatibility.

## Procedure

1. Read root and scoped AGENTS.md and inspect the adapter, command contracts and
   actual domain engine. Preserve concurrent edits and historical evidence.
2. Before changing runtime code, reproduce suspected defects with a failing
   regression. Use original small fixtures, injected capabilities and memfs;
   unit tests must not spawn native programs, write host files or query an LLM.
3. Check exact raw argument bytes and immutable carrier ownership, literal command
   naming, collision preflight, replacement policy, normal agent-shell invocation,
   cwd/VFS routing, stdin provenance and exported environment forwarding.
4. Check synchronous cleanup registration before acquisition, cancellation reason
   identity, cooperative resource drainage and idempotent overlapping cleanup.
   Check retained host binding records against caller mutation.
5. Repair validated adapter defects only. Keep conversion logic in the domain
   package and coordinate domain contract or root integration repairs with owners.
6. Run focused cases, then have the integration owner run maintained uncached
   build/test/lint checks including cross-workspace coverage. Record exact coverage
   and unresolved cases; do not count unsupported or unmeasured cases as passes.

## Verified independent cases

`packages/safe-bash/tests/commands/ssconvert-plugin-stress.test.ts` has eight cases:

- A failing descriptor-binding mutation case produced `replaced` instead of
  `original`. The adapter now snapshots descriptor records and maps at creation.
- Adapter-map replacement and transport-hook replacement preserve the initially
  selected adapter and bound transport methods, including their original receiver.
- Distinct invalid UTF-8 raw options retain distinct exact byte diagnostics after
  the incoming byte array is mutated; both return status 1 with empty stdout.
- Duplicate registration rejects before namespace change. Explicit replacement
  replaces only literal `ssconvert`; no uppercase alias is introduced.
- `agentCommands()` plus the explicit plugin accepts ordinary piped `ssconvert`
  invocation and preserves output bytes/status without new command syntax.
- Actual Shell default-empty and pipeline-empty input preserve distinct `true`
  and `false` provenance at the codec. A custom host omitting provenance preserves
  `undefined`; identical empty input bytes never determine the origin.
- Cancellation preserves the original abort reason, emits no output and drains
  a cooperatively owned codec resource before rejection.
- Cleanup registers before VFS read, relative input resolves under `/work`, codec
  cleanup runs exactly once across repeated cleanup calls, and memfs retains the
  original input and sentinel namespace unchanged.

The focused direct Node execution passed all eight cases on 2026-09-21. This run
is fresh developer evidence, not a substitute for maintained guarded checks.

## Limits and owner follow-up

The independent suite does not execute the native oracle or establish complete
format, plugin, locale or dependency-profile parity. Native reference acquisition
and release matching remain separately owned QA evidence. It does not test
uncooperative host work, arbitrary concurrent mutation of borrowed capability
objects, or cancellation rollback of completed namespace effects.

The adapter forwards `stdinIsDefault` when present; domain propagation was added
and tested by the integration owner and independently verified through actual
Shell provenance cases above. Exported environment and PWD replacement regressions
are separately implemented by that owner.
Portable exports, dependency/startup measurements, maintained command inventories,
build guards and cross-workspace uncached checks remain root integration ownership.
No Git, push, publication or README edits are part of this independent pass.
