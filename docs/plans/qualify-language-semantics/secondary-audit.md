# Secondary language-owner evidence

The complete V4 inventory contains **126 additional nonpasses** whose primary
owner is `qualify-resource-and-timing-behavior` and whose secondary owner is
`qualify-language-semantics`. They are separate from the 334 primary-owner
variants audited in `audit.md`.

Their original fixture hashes were checked against Test262
`419d3e0a2273ba01a3bfcbec423f2801425b8e93`. Reusing those exact cases and their
recorded neighbors selects **129 files / 224 variants**. The literal maintained
invocation is in [secondary-command.json](secondary-command.json); the selected
ledger is [secondary-ledger.json](secondary-ledger.json).

[The complete report](secondary-current.jsonl) ran from
2026-09-13T14:45:05.607Z to 2026-09-13T14:52:51.305Z and exited **1**:
**98 passed, 126 failed, zero unsupported, metadata errors or execution errors**.
All 126 original nonpasses still time out; the 98 additional control variants
pass. Nothing was retried, removed or reclassified as passing. Each original
file/mode/hash, owner, esid, prior result, current result and neighbor is retained
in [the reconciliation](secondary-reconciliation.json).

Parent SHA: `eece392d0ee622f2c460f3a1cfec6ae752b02a63`, including the preserved
working tree and uncommitted no-initializer repair. Execution fingerprint:
`fc66620e5e52017f7c02257f3fbf2760d4c13b6da69cfcf2e270931f0a69d015`.
Node **22.23.2**, ICU **78.2**, V8 **12.4.254.21-node.56**, Darwin arm64.
[A post-run source comparison](final-source.json) confirms the same fingerprint.
Per-variant deadline remains **3000 ms**, startup allowance **10000 ms**, and
the effective budgets are unchanged. Different source fingerprints are not
combined into a synthetic all-pass aggregate.

These include exhaustive Unicode/lexical cases, tail calls, asynchronous
destructuring and resizable-buffer iteration. A timeout is concrete noncompletion
under the maintained resource contract; it is not by itself evidence that a
particular ECMAScript value or early-error rule is wrong. Resource/performance
ownership and unresolved semantic qualification remain explicit. This prevents
historical timing failures from disappearing behind newer semantic repairs.

[Eight minimal diagnostic pairs](unresolved-minimal-controls.json) additionally
reproduce representative remaining primary-owner mismatches, with passing
neighbors and native controls: destructuring key/coercion order, optional-chain
tagged-template early errors, regexp after a block, Annex B arguments binding,
ordinary/async generator creation order, duplicate prototype setters and BigInt
destructuring keys. The expected behavior comes from the corresponding pinned
upstream clauses recorded in the primary reconciliation; native results are only
controls. These cases remain **unrepaired**, not new passing regressions. A first
standalone BigInt diagnostic process rejected with TypeError before its receipt
could be written; the corrected diagnostic catches and records that rejection
without changing the guest program ([record](bigint-property-initial.json)).

The two legacy caller cases have a separate [extension/oracle disposition](caller-disposition.md)
and remain raw fixture nonpasses. The decorators and separately pinned resource
management cases likewise remain visible; neither the published edition nor
the extension target was redefined.

Both repaired CLI examples were captured and visually inspected using the
maintained generic command route:

```sh
npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/eval-deleted-smoke.ajs
npx tsx scripts/screenshot.ts node packages/safe-js/dist/cli.js docs/plans/qualify-language-semantics/eval-var-smoke.ajs
```

The [global-function image](eval-deleted-cli.png) and [var image](eval-var-cli.png)
show readable complete commands and their expected successful JSON outputs.
No screenshot unit test or CLI presentation change was introduced.

**Task acceptance remains incomplete.** Two narrow semantic repairs do not close
the 193 earlier remaining primary-owner nonpasses, these 126 freshly reproduced
resource nonpasses, other focused-owner dependencies, or missing full runtime,
recovery and artifact qualification. Local repair commits are separate from
verified remote-main delivery and publication. No task push or release has
occurred; previous tasks' release receipts cannot substitute for those steps.
