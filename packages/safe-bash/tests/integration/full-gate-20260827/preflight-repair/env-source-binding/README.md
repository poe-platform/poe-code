# Frozen env source selection — 2026-08-27

Read-only forensic reconciliation of this worker's original gate, consistent
with Sagan's separate `804cb6e6` binding addendum. No product suite, native
oracle, new implementation or independent feature acceptance is performed.
The original **16,520 pass / 307 fail / 13 skip, UNQUALIFIED** remains unchanged.

## Decisive cause, not a fixture migration

Implementation `84ab66ca717e0dff21abf57051b41cb553f3c7f3` has immediate parent
`b494675c34dc289f4ad4b10a9201e1211eb0a7d8`, the actual selected archive. That
choice used the genuine preimplementation ancestor; it did not silently select
the later implementation or cherry-pick tests onto it. The author tests were
already present. Sagan's addendum authenticates all seven test/helper inputs and
records their unchanged source, statuses and retained protocol differences.

| Source | b494 selected gate | 84ab implementation |
| --- | --- | --- |
| `src/commands/execution.ts` SHA256 | `1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700` | `61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6` |
| `src/commands/env-split.ts` SHA256 | absent | `b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4` |

The old execution parser accepts `iu:0C:`, not `S`. These are the only two
production files changed between those revisions. Thus the 84 old failures
belong to valid tests against absent implementation, not expectation defects.
The separate five old passes remain in the 89-case cohort. No test migration,
retroactive pass credit or whole-kernel closure follows.

## Independent capture reconciliation within this gate

`audit.mjs` authenticates all **716** original canonical import capture payloads
against their stored and uncompressed hashes. It identifies 27 env processes:
one native-test process, one host wrapper and 25 host children. The native test
and all 25 children resolve the selected archive's `src/commands/execution.ts`,
with the exact b494 hash: **26 matches, zero mismatches**. The wrapper itself
only launches children and has no product resolution. No process resolves the
absent env parser or a compiled `execution.js` substitute in this cohort.
Entry fixture hashes are checked against the same Git revision.

This directly corroborates older-source selection. It does not identify a hidden
dist fallback, stale fixture overlay or alternate source loader. The original
hook records **resolve-stage physical paths and raw file bytes**, not the
transformed source returned by a load hook. That measurement boundary is retained;
there is no retroactive proof of every evaluated instruction.

The separate accepted implementation review is `8ab67747`, not this audit.
Its supported core, stricter diagnostic losses, shebang/kernel protocol gaps
and different native parent profiles remain separate. See
`tests/shell-stress/env-split-gate-routing/BINDING_ADDENDUM.md` for the exact
7/7 supported versus 7/10 whole packed profiles, hidden 40/48 profile and
the three diagnostic / five hidden protocol losses. Do not pool these results
with the original canonical 89 or call the entire native profile green.

## Successor gate binding requirements — not yet implemented here

The next root-selected commit must contain the accepted implementation and all
other required sealed fixes. Derive expected hashes from that exact commit,
never from the moving checkout. If later authorized changes alter either file,
require the selected revision's reviewed hashes rather than assuming the 84ab
hashes remain current. Before starting the expensive suite:

1. Authenticate the candidate archive and both source paths; reject absence or
   stale bytes. Native prerequisites and tracked-input immutability must pass.
2. Require canonical env child processes to resolve those candidate `.ts` files,
   rejecting stale compiled/source fallback. Require both files in every env
   execution process; the launcher-only wrapper is explicitly not such a process.
3. Record physical resolution plus actual loader-returned bytes and loader
   identity per process. Missing receipts must fail qualification, not silently
   count as authenticated execution. Keep transformed and raw hashes distinct.
4. Keep a separately authenticated fresh-build/moved-package consumer witness;
   source execution and public compiled execution are different cohorts.
5. Exercise bounded old-execution, missing-parser, compiled-fallback and
   missing-load-receipt negative controls before admitting a new whole gate.

These are the requested successor qualifications, not a claim that a new loader
or candidate policy is already accepted. No whole gate is launched here.

Reproduce the read-only capture audit into an exclusive task-owned file:

```sh
node tests/integration/full-gate-20260827/preflight-repair/env-source-binding/audit.mjs /tmp/NEW-ENV-BINDING.json
```

`evidence.json` preserves the observed source identities, 716 capture hash
references and 27 process records. The command does not alter the original
capture files, source, native fixtures, private checkout or product state.
