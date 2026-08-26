# Approved identity repair checkpoint

Source commits: `57d9d9860bd51fabd910814efeea4efbca0e4c26` and
`4fa4ba9502dac843bd13aa5031d128a3171f597d` (latest source checkpoint).
Contract authority: Curie's `fa539de`, not the earlier unapproved proposal.
The exact approved owner message and normative identity text are captured here.
`manifest.json` records commands, source/tree/oracle hashes and artifact hashes.

## Immutable old cohort versus new results

The original `2fdaf6c` handoff and 62 earlier evidence artifacts are unchanged,
verified byte-for-byte against that commit. The three frozen test files are
also byte-identical to `2fdaf6c`; no original4/required49 expectation changed.

| Cohort | Historical observation | New author replay |
| --- | --- | --- |
| Original committed reproduction | 1 pass / 4; three source-truncation failures | 4 / 4 pass |
| Required pre-effect guards | 11 pass / 49; 38 required-red cases | 49 / 49 pass |
| Old pre-rmdir five-owned checkpoint | 533 / 574; original3 + required38 failed | Preserved, not relabeled |
| New complete five-owned suites | Different cohort, includes subsequent rmdir and identity tests | 642 / 642 pass |
| Shared conformance | Separate cohort | 202 / 202 pass |
| Scoped TypeScript `--noEmit` | Five-owned source/tests and imported types | Exit 0 |
| Isolated source mutants | Six deliberate unsafe changes | 6 / 6 detected |

Expanded focused tests passed 203/203 before the final source commit. They overlap
the frozen53 and complete-owned642, and must not be added to those denominators.
The old 38 red cases were newly required guards, not 38 regressions in previously
green tests. No pending required-red remains in these author-replayed cohorts;
independent frozen-checkpoint review remains separate and pending.

## Implementation and expectation changes

- Memory publishes a token per independent store. All native-real instances
  publish `Symbol.for("virtual-bash.fs.native")` only with safe native IDs.
- Readonly, mount and overlay snapshots preserve actual backing identities.
  Overlay copy-up exposes the new selected upper identity, not the old lower one.
- Mount and overlay reject complete same-entry tuples before source acquisition,
  writes or publication. Invalid/partial identity is unknown, not disjoint.
  Mount also refuses unknown existing same-mount destinations: arbitrary method
  presence is not an authoritative native guard. Known distinct copies remain
  supported. Observed missing mount targets use exclusive creation.
- Overlay metadata resolution and rejected copies do not clean pending staging
  garbage before the guard. A deterministic regression checks this physical
  namespace effect through both direct and mounted aliases.
- The old constructor rejected reusing a backend at multiple mount locations.
  That contradicted the frozen required same-backend/multiple-mount guard.
  Two configuration tests now positively verify repeated views, same backing
  stats, alias `EINVAL`, exact bytes, and valid distinct copies. Duplicate mount
  keys still fail. The exact prior test file is preserved as
  `original-mount-constructor-tests.ts.txt`; this is a deliberate policy repair,
  not a weakened required alias oracle.
- Owned `Required<FileStat>` fixtures gained real opaque scope tokens and
  getter/snapshot checks, retaining all previous metadata assertions.

The first mutation probe run produced six failing mutant child processes, but
its strict `ERR_ASSERTION` classifier counted only five: the coordinate-collision
mutant threw `EINVAL` in a formerly successful copy. That first JSON/stderr is
preserved. The probe now also runs the explicit opaque-scope equality assertion;
no frozen control was modified and all six mutants satisfy the strict classifier.
Probe hashes confirm production sources were unchanged by mutation experiments.

## Limits and ownership

Unknown remote identities still require a truthful negotiated authority for
existing copies through mount/overlay; arbitrary client tokens, hashes and ETags
cannot supply disjointness. Missing-target exclusive creation remains useful.
Direct backend-native copies retain their own guards. No S3/WebDAV source/tests,
contracts, commands, root docs/exports or independent-review files were edited.
No rmdir behavior changed. Foreign working-tree/index work was preserved using
explicit-path `git commit --only`.

Identity is point-in-time only: no lease, ABA defense, pathname stability,
external-writer transaction or global atomicity is claimed. Disjoint failed
destination writes can leave that destination partial; buffering is not the
source protection. Overlay retains its documented immutable-lower and exclusively
owned-upper prerequisites. All launched validation workers have exited.
