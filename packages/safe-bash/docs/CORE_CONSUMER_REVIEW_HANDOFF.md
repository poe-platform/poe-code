# Distinct-leaf core consumer review: bounded gate closed

Update August 27, 2026: Plato completed the distinct review in
`tests/commands/filesystem-authority-stress/README.md`. Source fix `0bee8e7`
protects cp-P source symlink entries through unscoped aliases and reports GNU9.7
EXDEV alias moves as status1. Frozen independent85/92 becomes92/92;11/11 mutants
are rejected. Separate test-only `fe97802` corrects exactly two stale status
assertions, retaining all source-preservation checks and historical68/70 author
evidence. The resulting author/contracts70/70 and independent92/92 pass, with
global types/build reported by the reviewer. Poincare's remote positive38 gate
is still separate and is not declared closed. The original pending handoff below
is preserved as history, not the current review status.

## Historical author request

Author handoff updated August 27, 2026. Curie authored the consumer changes and
cannot label its own verification independent. No completed distinct-leaf review
of the committed consumer seam was found at the current checkpoint. Root must
assign that review; this document is not an independent acceptance result.

## Exact scope

- Contract `5076b32`: `src/contracts/filesystem.ts` and `filesystem.md`.
- Consumer `f291156`: `src/commands/copy-identity.ts`, `filesystem.ts`, `move.ts`.
- Test-only exact-optional correction `b291e2a`; no product behavior change.
- Underlying move fallback `7b04783`, scoped-copy fix `37e19b7`, force-unlink
  recheck `a0a32a7` remain relevant. Preserve those historical cohorts.
- Independent `29fe1bf` reviewed the proposed authority design/prototype, not
  the later committed production consumers. Do not transfer its pass count.

## Reproduction inputs

Author focused64 tests: `tests/commands/copy-identity.test.ts`,
`tests/commands/move-cross-device.test.ts`, `tests/commands/entry-comparison.test.ts`.
Shared type tests: `tests/contracts/filesystem-comparison.test.ts` and
`tests/contracts/filesystem-identity.test.ts`. Use an explicit git archive and
record source revision/hashes, not a moving worktree represented as frozen.

```sh
node --unhandled-rejections=strict --import tsx --test \
  tests/commands/copy-identity.test.ts \
  tests/commands/move-cross-device.test.ts \
  tests/commands/entry-comparison.test.ts \
  tests/contracts/filesystem-comparison.test.ts \
  tests/contracts/filesystem-identity.test.ts
```

Independent tests should exercise actual same-entry and distinct-entry views,
missing comparison, unknown/invalid/conflicting replies, complete tuples,
same-object and peer routing, cancellation between authority work and effects,
metadata errors and unknown final symlinks. Prove copy success precedes source
cleanup; copy/no-op/partial failures must not silently delete the source. Test
forced-unlink races and actual exclusive creation without weakening existing
guards. Broad trust flags, per-client fake identity and recursive directory
cleanup are not allowed. Preserve before/after bytes and typed boundary errors.

Poincare owns all FS implementations and reruns required positive38 plus safety
guards after authority implementation. Current pinned cause-map2647bcf remains
28/38 positives plus5/5 rejection controls; the ten remaining cases are not
declared closed by the new type or author tests. Permission-profile adjudication
is separately documented and cannot relax identity safety.

Point-in-time comparison does not promise conditional deletion, ABA/pathname
stability, destination rollback or malicious-provider authentication. Review
these as explicit limitations, without using them to excuse avoidable source
truncation or rejecting all qualified positive remote operations.
