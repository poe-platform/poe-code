# DIFFERENT actual YQ reviewer — August 28, 2026

## Verdict

**Bounded aggregate FAIL; review stops without retry or product patch.** The
single frozen integration invocation stopped at `total-admission-bound` after
167 of301 planned children. Parent PID87703 exited1 naturally after619,594ms;
no signal, watchdog timeout, overflow, spawn error, or kill occurred. All167
admitted children exited0 and were reaped; full input integrity and known-owned
reap passed. This is not a YQ execution timeout or a passing full review.

Preseal commit: `7d3423edda8de5f125cabb884d49c3712e5e25d3`.
Exact root envelope SHA256:
`74afb45f09d1a7189f816ec09a68fe1727a4cab3a285ba844f05d7a7e3afdce9`.
Source/recipe/toolchain identities, raw inputs, predicates and limits were
committed before first product import. No author26/19 tests or previous
synthetic controls were replayed. No native YAML, network, private runtime,
dependency installation, product modification, public routing, or XAN work.

## What actually ran

| Role/environment | Actual scope | Raw result |
| --- | --- | --- |
| Source/package admission | One child, selected271/full870 | Scoped identity observation matched; not compilation/semantics |
| Original direct factory |149 jobs,132 original IDs |120 projection matches;29 failures |
| Moved direct factory |17 jobs,17 of the same original IDs |14 projection matches;3 failures |
| Remaining moved |132 jobs |Unrun after sealed admission limit |
| Dedicated loaded-code control |One planned child |Unrun |
| Direct declarations |One planned worker/six compiler fixtures |Unrun |
| Source-static |23 designated IDs |Four source counterproofs; other observations remain partial/support-only |
| Critical source annotations |ENC-07 and WRK-22, existing original IDs |Not additional cases or semantic passes |

There are166 runtime jobs across132 distinct original IDs, not166 or298 unique
cases. Original semantic-role observations cover111 IDs/128 jobs:103 job
projections matched,25 failed, and86 IDs have all their admitted fragmentation
projections matched. The other21 original jobs are admission-role observations,
not semantic passes. Moved coverage includes only three semantic-role IDs and
14 admission-role IDs. These environments are not additive denominators.

Of32 raw failed jobs,31 are `UNFULFILLED_OBLIGATIONS` (28 original, three moved)
and one is the CMD-22 framework path assertion below. Unknown obligations stay
INCOMPLETE/FAIL. A separate read-only audit of already captured primitives found
no contradiction in declared status, explicit stdout bytes or diagnostic-code
text across166 runtime captures. It does not exercise missing assertions,
rescore any failure, establish complete diagnostic semantics, or prove absence
of product bugs. **No runtime product bug is established by those primitives.**

## Source counterproofs, not private runtime traces

These are source-level contradictions of the designated allocation-order
obligations, not newly executed boundary examples. No private ledger, changed
limit, injected session, observer or additional product probe was introduced.
The near-cap scenarios remain runtime-unfulfilled. Exact source excerpts,
Git blobs, line spans and hashes are in `execution/SOURCE-EXCERPTS.json`.

1. **WRK-06 — document admission is late.** Selected `yq/index.ts:231` copies
   chunks, then `:349` decodes the complete source. `yq/parser.ts:855` constructs
   normalized lines before `:938` calls `beginDocument`. The frozen
   before-copy/before-decoded-append obligation is therefore not implemented.
   Line855 also normalizes CRLF before line862 computes purported raw bytes.
2. **WRK-07 — scalar admission follows construction.** `yq/parser.ts:472`
   decodes the quoted scalar before line473 calls composer.scalar; that method
   checks scalar bytes at line531. `decodeDouble` appends characters at line277
   before the scalar gate. No four-byte near-cap private trace was run.
3. **WRK-13 — member admission follows child parsing.** Flow sequence line396
   awaits prospective child construction before line408 checks the parent
   collection member limit. This does not satisfy refusal before input-member
   allocation, even though the eventual parent insertion is checked.
4. **WRK-17 — retained encoder fragments precede their cap check.**
   `yq/encoder.ts:62` concatenates escaped text before `append` checks bytes at
   line17. Final output allocation and publication are preflighted at
   `yq/index.ts:402`, but that does not prove every retained encoder allocation
   was preflighted. No private output-counter state was manufactured.

Selected source SHA256 values (all from35da's authorized new-source set):

- `src/commands/yq/parser.ts`:
  `ec3c47823eca85730af613f460bf98d28182ea28a68473eb7e596dc780334a79`
- `src/commands/yq/index.ts`:
  `ffa76c2b111d915973634ff1238a709a9a90b1a5db000c690649519378afb283`
- `src/commands/yq/encoder.ts`:
  `77441f383d339d05d4db92a28dd04cd45eda97ad090b82cba808d322e5a151f5`
- `src/commands/structured/query-core.ts`:
  `d2501cff9e74757f9e9bd80e1cf78722d321e19a6fb4a5c3e18a29d0e224cf0a`

CARRY arithmetic/state persistence, shared close/return, counter checks and
alias projection-before-copy have specific source support, not private runtime
acceptance. Descriptor-relative alias depth alone does not establish insertion
depth preflight. Source-only observations do not close the original gaps.

## Framework findings and minimal routing

### F-ACTUAL-01: finite schedule did not complete

The frozen600,000ms admission budget stopped before the remaining132 moved
jobs and the dedicated loaded/type controls. Observed moved child elapsed
times were16,840–27,231ms on this cohost; each successful child stayed below its
30,000ms deadline. This is a framework scheduling/coverage failure, not evidence
that YQ timed out. The configured bound and all raw outcomes remain unchanged.

Route to the integration owner: preseal a schedule/implementation that can
complete its declared scope while retaining exact authentication and reap
guards. Repeated admission work is visible in the frozen moved-worker path,
but this run does not isolate its timing or prove a performance root cause.
Do not silently widen this run, reclassify unrun work, or patch the product.

### F-ACTUAL-02: CMD-22 compares different path domains

Minimal frozen benign input:

```text
argv = ["--output-format=json", "--compact-output", "--", ".", "-name"]
file operand "-name" contains "false\n"; context cwd is "/v"
```

Capture: status0, stdout`false\n`, empty stderr, unchanged file bytes, and
signal-forwarded VFS read of`/v/-name`. The frozen expectation lists the operand
`-name`. Runtime `assert-capture.mjs:44` compares event paths directly to that
list; context's line42 resolves fixture names against`/v`, and product
`yq/index.ts:255` correctly resolves the VFS input path against context.cwd.

Raw evidence remains FAIL in
`raw-compound/captures/run-2026-08-28T10-19-29.600Z-b6244431-0a29-4dcb-b399-2579eab26b61/CMD-22--whole/`.
Assertion source SHA256:
`d4b58ff54cc6caf93b1628d6c51628f5a3ebbc53d71611c1a5748530cef264bd`;
context source SHA256:
`b4827ee8656e9d2a88a23176c9b61b757bf9d4c79f8c46463c5cb579e42e7821`.

Route to the runtime assertion owner for an explicitly sealed distinction
between operand spelling and resolved VFS paths. This review changes neither
the fixture nor the assertion, does not rerun CMD-22, and does not label correct
VFS resolution a product bug. No declaration-fixture failure was observed,
because the entire type stage was unrun.

## Provenance and separate build proof

The execution uses the exact original full receipt trusted by root solely as
AUTHOR_ARTIFACT_BINDING_ONLY. Its historical false flags are unchanged. The
selected source is baseline5137 + accepted interpreter7436 + seven35da files,
not a whole35da/HEAD tree. Archive273, consumer271 and package870, original and
previously moved physical copies, all remain preserved and authenticated.

Part A arrived after the execution preseal and was authenticated separately:
commit`f7503dc7dce11f9a3072b3670df498d64305d737`, receipt
`ae74c3f95061d481aec2dab99260214eb22babf5b1d2682b37928a9cc8dd62d6`.
Its single scoped compiler exited0/reaped.434 JS/declaration outputs match raw;
434 maps require explicitly disclosed source-path relocation; the final870
package map and tgz hash match the author-bound artifact. This reviewer verified
the committed21-file proof, source/raw-output trees and package identity without
recompiling. It is additive proof, not a changed execution envelope or public
integration. The old full receipt was never replaced.

## Coverage gaps and preserved history

All194 original records/eight overlays retain the111/34/23/11/4/5/6 role split.
The94 complete-projection eligibility and17 partial semantic records are not
results. Original80 binding gaps remain (62 absent,18 partial). No lifecycle
role, private fixed-P1 counter trace, runtime CARRY observer, or dedicated type
control became a pass. The full194 coverage ledger is`execution/COVERAGE-194.json`.

NUM-14/15, ENC-07 and UTF-12 ran but remain unknown-obligation failures. QUE-12
has a matched original projection only. WRK-10 remains unrun; WRK-22 and WRK-26
have source-only observations. No overlay received moved-runtime coverage.
Public exports are intentionally absent; direct modules/declarations are not a
public-integration bug. Global typecheck:all remains outside this task and was
not run; the known foreign.mts blocker is not waived.

The original409 refusal, b932 findings/F01/F02, author failures, historical
postprocessor aggregates and packet false flags stay unchanged. Two local
data-preparation failures are also retained in `PREPARATION-HISTORY.md` and raw
stderr; neither imported product code or reran a product case.

Evidence includes1,667 capture files and two runtime metadata files copied
byte/mode-exact, all167 child boundaries/raw receipts, parent status,42 complete
input guards, and17 fresh physical package-move proofs. Added-entry checking is
explicit; it is not change-and-restore detection or a transaction. Original raw
captures and external package copies were not deleted. No full-YAML conformance,
native parity, public acceptance, superiority or overall release conclusion.
