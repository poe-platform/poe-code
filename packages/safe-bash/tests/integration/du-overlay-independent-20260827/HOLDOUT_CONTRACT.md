# Independent DU + overlay metadata-read holdout contract

## Freeze record

- Frozen at `2026-08-27T18:11:22Z` by the new independent leaf verifier.
- This document was written before this verifier inspected or executed product
  source. It does **not** claim to predate implementation work or commits by any
  author.
- No author candidate hash was supplied. The mutable checkout was observed at
  `7f3ad2f53433e6944260659c8d3904108e5a5a6a`; that observation is chronology,
  not a candidate selection or acceptance input.
- Known source baseline:
  `877144ea3a5223bbdf3e7ebfd50a8f8caaa474f3`.
- Known author evidence revision:
  `f2d6f710d9e0b9481957ff302bba90a0f11c9bad`.
- Known first-independent evidence revision:
  `19cc7e8c3567b521e04159010efe32da5673b5b4`.
- The pre-freeze foreign index was empty: cached binary-diff fingerprint
  `e69de29bb2d1d6434b8b29ae775ad8c2e48c5391`. Foreign worktree and untracked
  files existed and are outside this verifier's ownership.

This freezes only the revision-verification holdouts below. It neither duplicates
the earlier full DU implementation audit nor defines a whole-project gate.

## Literal filesystem matrix

Each case uses fresh, instrumented upper and lower memory filesystems. The
observable record comprises byte-for-byte namespace snapshots, relevant stat
identity fields, and per-operation counters split by layer. The literal virtual
tree is rooted at `/holdout`:

```text
lower: /holdout/lower-only.txt = "lower-only\n"
lower: /holdout/shared.txt     = "lower-shared\n"
lower: /holdout/sub/child.bin  = bytes 00 01 02 03
upper: /holdout/shared.txt     = "upper-shared\n"
upper: /holdout/upper-only.txt = "upper-only\n"
```

The pending-garbage fixture adds a real upper entry at the implementation's
supported pending-cleanup location and records the exact pre-read upper snapshot.
The active-stage fixture places the same logical overlay behind an active stage.
Wrapper cases exercise the project's faithful filesystem wrapper(s). Mount cases
exercise the overlay below and above a mount boundary at literal `/mnt` paths.
Fixtures may be adapted to public constructors after inspection, but these paths,
bytes, layer roles, and observations must remain literal and versioned.

For every direct overlay, pending stage, active stage, faithful-wrapper, and mount
composition supported by the inspected APIs:

1. `readdir`, `stat`, and `lstat` are metadata reads. A standalone DU traversal
   through its module path is also metadata-only.
2. Before/after backing snapshots are byte-for-byte equal. In particular, there
   are zero upper/lower mutation operations, zero copy-up operations, and zero
   content-read operations. Metadata operation counts may increase.
3. A pending-garbage backing entry is absent from the merged listing and DU
   traversal while remaining unchanged in the upper snapshot.
4. Existing whiteout state and visible-name resolution are stable. Visible stat
   identity fields and any supported `compareEntry` result are stable before and
   after traversal; missing identity remains missing rather than fabricated.
5. A metadata failure injected at a deterministic path produces failure without
   backing changes. Removing the injection and retrying succeeds without an
   intervening cleanup mutation.
6. A pre-aborted signal, and a deterministic mid-traversal abort where the API can
   observe it, reject/return the documented cancellation result without backing
   changes. Cancellation is not treated as force-ignorable filesystem failure.

The original strict DU-over-overlay no-mutation recipe is retained as historical
evidence and is expected to be red on the source baseline because it observes one
upper removal. This revision suite versions rather than overwrites that artifact.

## Literal positive and negative controls

- Explicit overlay cleanup is invoked through its real API after a pending entry
  is prepared. It must perform the expected cleanup mutation and make the counter
  and snapshot oracle detect it.
- A normal overlay content mutation at `/holdout/shared.txt` must change the
  backing snapshot and increment a mutation counter.
- A normal content read of `/holdout/lower-only.txt` must increment the content-
  read counter, proving the metadata traversal's zero count is discriminating.
- A deliberate test adapter/behavior mutant that removes the pending upper entry
  during `readdir` must make the purity holdout fail.
- A deliberate adapter/behavior mutant that reads file content during DU traversal
  must make the content-read holdout fail.
- A deliberate adapter/behavior mutant that copies a lower-only entry into upper
  during metadata traversal must make the snapshot/copy-up holdout fail.

These are executable perturbations of real adapter behavior, never merely inverted
assertions or intentionally wrong expected values.

## Literal DU environment matrix

Use a discriminating file fixture whose displayed total changes under a selected
lower-priority `BLOCK_SIZE` value. Do not freeze a numeric default; discover only
the no-environment output from the same authenticated baseline execution.

For each selected variable supported by the command's existing precedence order:

1. With all unit-selection environment variables absent, capture `defaultOut`.
2. Set lower-priority `BLOCK_SIZE` to a valid discriminating value and verify its
   output, `lowerOut`, differs from `defaultOut`.
3. Also set the selected higher-priority variable to literal `invalid-value`.
   Its output must equal `defaultOut`, not `lowerOut`.
4. Repeat with the selected higher-priority variable set to the literal empty
   string. Its output must equal `defaultOut`, not `lowerOut`.
5. An explicit literal `-B invalid-value` remains strict and must fail according
   to the command contract; the environment fallback rule must not weaken it.
6. A valid explicit `-B` value remains functional and takes its documented
   precedence.

The matrix makes no claim about repeated operands; that policy is pending root
relay and is outside this frozen contract. Standalone DU is loaded through its
actual module path because public DU export/registry wiring is intentionally
absent.

## Evidence and package constraints

- Execute the source baseline from an isolated committed archive, authenticate
  commit and relevant source bytes, and preserve raw failures without rewriting.
- Later candidate execution waits for an exact candidate hash from the root; do
  not substitute mutable `HEAD`.
- Moved-package proof installs an actual packed/built baseline into a relocated
  strict TypeScript consumer, imports standalone DU through the supported module
  path, and authenticates resolved package/load paths so repository fallback is
  rejected where feasible.
- Relevant regressions, explicit cleanup, and mutation controls are reported
  separately from holdouts. Unsupported compositions are gaps, not passes.
