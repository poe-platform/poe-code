# Exact isolated source review before independent execution

2026-08-27. Cases froze in `6d6c00d8`; exact historical replays and setup
drivers in `40f73ef3`; independent candidate driver in `a035cb1f`.
Author receipt arrived after 100,029 ms of the bounded 300,000 ms wait.
No candidate execution preceded this source inspection.

## Authentication and order

Accepted base `21220b465537bf45ffcfb36740956a69f43bf75e` is extracted directly
with `git archive`. The single patch changes only `src/commands/expr/bre-worker.ts`.
Patch SHA256: `900d10baaaad15e6e428747ca5815b3c284f14a612d6752c9b7bdf91b2fed6de`.
Candidate worker SHA256: `663b0b9010d939df16910c75d543f7a41cee832d6cd7cc2ab142996386206890`.
Before and after inventories have exactly the same 243 paths; only that worker's
hash changes. Four shared execution modules are byte-identical to accepted base.
No live product overlay, author test overlay, package change, or worker protocol
change enters the candidate. TypeScript transpile-only emission is not typechecking.
All exact hashes and emission identities are in `isolated-01/provenance.json`.

## Admission and state review

Locations refer to the authenticated candidate DATA, with identical source line
numbers after application. This is a bounded source review, not a proof of all
input/resource combinations or an exact physical-memory accounting model.

- Lines 53–70: work/allocation/node/state checks precede their respective
  counters and object creation. Allocation also charges work. Node/state limits
  are cumulative admissions, not simultaneous live-memory limits.
- Lines 85–109, 112–128, 140–162, 164–198: AST nodes, repetition descriptors,
  parser arrays/entries, closed-group set entries, and bracket components have
  prior reservations. Class-name growth/scans are charged. Depth and 32-group
  ceilings remain; bounded decimal repeat counts do not expand code by count.
- Lines 208–264: each repeat lowers once; group-index scans, alternatives,
  backpatch scans and instruction construction are charged before growth.
- Lines 288–318: byte-scaled reservations precede decoding, values/boundaries,
  pattern tokens, and input/instruction scans. These conservative logical units
  are not RSS or a promise that every byte-cap-admitted input fits allocation.
- Lines 319–330: initial and fork states are admitted before vectors/objects;
  forks copy capture/frame vectors and share immutable history nodes. Each new
  history node is separately pre-admitted. No input-sized history comparison
  takes place; the retained history is not used to choose ties.
- Lines 345–385: static entry identity plus branch-local immutable frame
  replacements track activation, parent iteration, count, position, required
  status and checkpoint. Productive iterations progress input; mandatory empty
  iterations progress bounded counts; optional empty exits the sole iteration
  or kills a trailing-empty branch. Forked exit states retain original vectors.
- Lines 390–411: opening a group invalidates its previous completion; closing
  requires an open record. Backreferences require completed participation and
  charge comparison length before scanning. Absent is not closed empty.
- Lines 339–342 and 426–431: open captures/live repeat frames cannot be accepted;
  whole extent takes priority. Only completed captures become byte boundaries;
  no `[0,-1]` conversion, partial-register normalization, input-specific branch,
  native process use, or main-thread regex execution was found in this source.
  The shared validator independently enforces ordered in-range byte spans.

## Explicit policy barriers before any promotion

1. Line 342 keeps the first completed DFS history on equal whole extent. This
   is an execution order, not Curie's established universal history comparator.
2. Lines 375–377 implement a general sole-optional-empty/no-trailing-empty rule.
   The narrow P/aaa derivation supports the relevant target, not every nested
   application of this policy.
3. Line 370 records absent history entries without clearing the capture vector.
   Captures in descendants not re-entered retain their last participation.
   Checkpoints/history are retained but not consumed by a restoration/comparison
   algorithm. This is the author's disclosed provisional policy, not a solved
   general nested-capture specification.

These assumptions exceed the established narrow target and bar general policy
acceptance or promotion. They do not prevent bounded observation in an isolated
snapshot. No concrete pre-admission bypass was found in the reviewed code; that
statement does not upgrade the assumptions into normative correctness. Proceed
only with the frozen cases and scoped safety controls, preserving every failure.
