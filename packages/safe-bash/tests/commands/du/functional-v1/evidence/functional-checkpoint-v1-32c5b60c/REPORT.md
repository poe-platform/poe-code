# Bounded DU functional checkpoint — August 27, 2026

## Commits and scope

- Classification evidence was sealed **before implementation** in
  `c288cfb02eb3ae9af86b16a7790b1e83767da593`.
- Functional source/tests/docs commit:
  `32c5b60c3323101ebd3d4a3339931caa93867ae5`.
- Production edits are limited to `arguments.ts`, `du.ts`, and the DU README.
  All new tests/drivers/docs live in `tests/commands/du/functional-v1/**`.
- No existing author tests, `backends.test.ts`, `overlay-purity.test.ts`,
  `independent/**`, provider source, contracts, AGENTS, root exports or package
  metadata were edited. Other owners' staging was preserved by explicit-path
  `git commit --only`; no shared `dist` build target was used.

The original `/tmp/du-native-difference-classification-4ijivX` report, raw cases
and validation note are exact-byte copies under
`../classification-v1-20260827-9a7c34d4/`. Its `SEAL.json` records original paths,
hashes, source 877144ea, author/independent evidence commits, ten rechecked pinned
Git source hashes, seven rechecked referenced captures and the oracle binary.
The original broader authentication and its limitations remain preserved, not
silently re-executed or promoted to current acceptance. All original 15 native
differences and all three new ordering records remain intact.

## Implemented behavior

O086/O087 selected invalid/empty environment formatting now falls back to 1024,
or 512 if the own context environment has POSIXLY_CORRECT. The selected variable
never falls through to lower-priority variables. Explicit `-B` stays strict.
Only bounded `UsageError` from format parsing is caught; environment byte/work
checks remain outside that catch. Allocation unknown/invalid rejection, known
zero, output limits, cancellation, registered cleanup and backpressure remain
covered. No ambient environment or new SIZE grammar is introduced.

O062 now reports `du: invalid zero-length file name`. Measured GNU output uses
that message; actual direct Memory/Real `lstat("")` rejection is recorded in the
native capture. DU still performs **no** empty/root lookup, returns nonzero and
continues later operands. It does not relabel real missing-path errors or print
an incomplete grand total. No general warning/usage rewrite or oracle absolute
path fabrication was added.

O060 is **proposal only**, documented at `../../O060-PROPOSAL.md`. No repeated
directory reporting suppression or inode pruning was implemented. The proposed
eligibility key requires the same command namespace, exact normalized operand
including trailing-directory semantics, and unchanged trustworthy scoped identity.
Even that is insufficient under mutable topology/concurrency: a second complete
traversal and bounded comparison cannot manufacture an atomic snapshot/lease.
Root must resolve that trust policy before any implementation. Deterministic
ordering remains unchanged; the three native stream-order gaps are not fixed.

## Author results

Final committed-source run: `../checks-v1-pgUSLL/`.

| Check | Result |
| --- | --- |
| New focused current tests | 47 passed; 0 failed/skipped/cancelled |
| Scoped strict TypeScript | exit 0 |
| Isolated ESM/declaration build | exit 0 |
| Built-module/plugin actual Shell | six checks, exit 0 |

Final raw comparison: `../comparison-v1-hMz3Z9/results.json`.

| GNU9.7/Darwin cohort | Result |
| --- | --- |
| 36 live rooted-Real functional cases: status + stdout | 36/36 exact |
| Same cases including stderr | 31/36 exact |
| Original frozen O060/O062/O086/O087 subset | 3/4 exact; O060 intentionally unchanged |

The five remaining new-matrix mismatches are explicit invalid `-B` diagnostic
wording, not different status/stdout or accepted bad flags. Frozen tests and live
tests assert exact product diagnostic strings; raw GNU strings remain preserved.
This is not a claim of full GNU compatibility, all original differences resolved,
or all 87/115 cases re-executed in this phase. No Linux native claim is made.

`../../native-observations.json` is a byte-identical frozen native-data copy of
`../native-v1-9HXVCz/native.json`, including complete argv/env/results, a 1025-byte
zero fixture, exact cwd, source hashes and binary identity. The native-case source
later gained only the explicit product diagnostic table; current argv/env arrays
are checked equal to the frozen input corpus. Native fixtures and children are
bounded and cleaned. The shared GNU binary remains read-only and hash-checked.

## Required owner migration: full DU suite is not green

Read-only targeted handoff: `../checks-v1-CTz5xl/unowned-expectation-handoff.stdout.txt`.
Nine selected legacy tests ran: five passed and **four failed**:

1. Existing `behavior.test.ts`: the old invalid-environment/no-FS assertion.
2. Existing `native.test.ts`: the old empty-operand diagnostic.
3. Existing `native.test.ts`: strict O086 invalid-DU_BLOCK_SIZE rejection.
4. Existing `native.test.ts`: strict O087 empty-DU_BLOCK_SIZE rejection.

These expectations need their owner's narrow migration to the approved behavior.
They were not edited, removed, excluded from canonical discovery, or counted as
passes. Original captures must remain unchanged when those tests are migrated.
The new 47-test green result is not current whole-DU acceptance. Root/package
export and packed-consumer integration are still not exercised by this leaf's
built-module checks. Independent review follows; this is author evidence only.

Provider metadata-purity work landed concurrently under a different owner; this
phase neither changes nor independently accepts that provider implementation.
The DU README now separates historical provider-side-effect evidence from current
provider-policy acceptance instead of asserting the historical bug is still current.

## Preserved failures and provenance limits

- `../checks-v1-0B5YqE/`: pre-patch new regressions, 18 passed, 26 failed, three
  cancelled. Strict environment rejection prevented a backpressure test from
  reaching its wait; the wait was made explicitly fail-fast, retaining the
  awaited-write assertion. Raw original failures remain preserved.
- `../checks-v1-hwDytV/`, `../checks-v1-HumZ64/`: earlier green scoped author runs.
- `../checks-v1-CTz5xl/`: green focused/type/build checks plus the four red owner
  migration expectations; the capture command correctly returns nonzero.
- `../comparison-v1-VbOXLW/`: precommit raw comparison, preserved beside the
  committed-source comparison.

Manifests record live git state, source hashes and checks of original paths.
No changed original source paths were observed in the final checks. This is not
an extracted immutable archive gate or append-proof whole-tree assertion.
Concurrent unrelated work never enters these explicit-path commits. Original
raw evidence is never rewritten by canonical tests or later captures.
