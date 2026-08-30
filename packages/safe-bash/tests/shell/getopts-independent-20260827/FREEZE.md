# Independent private getopts Phase 1 — freeze-only checkpoint

## Authority and hard stop

This delegated leaf reviewer owns ONLY new files beneath
`tests/shell/getopts-independent-20260827/`. No agents were spawned. No AGENTS,
product, root exports, package files, foreign tests, or private repositories were
modified. The root must explicitly resume this reviewer before candidate source
inspection, compilation or execution. The first phase ends at the atomic freeze
commit containing this file; the commit ID is reported outside this self-bound
document. This is an independent control freeze, not scanner acceptance.

Session ID reported by `CODEX_THREAD_ID`:
`01a044aa-5c10-7831-84fd-45eafeade370`.
Draft clock observation: `2026-08-27T19:22:55.843Z`; the manifest records its own
later creation time. Actual work is not claimed to span 72 hours.

## Commit identities and independence chronology

| Role | Full commit | Git committer date observed |
| --- | --- | --- |
| Author API/native freeze | `10291e716fefb939a7d1f4ffed5b24591fd1b664` | 2026-08-27 14:04:41 -0500 |
| Candidate under review | `157d78c957b56f83f6e705fc35da60b1f2ea3a9b` | 2026-08-27 14:13:37 -0500 |
| Author handoff/evidence | `a03b9288a6f4b652387be9fefa8faf17ef58b9e7` | 2026-08-27 14:16:28 -0500 |
| Live HEAD at initial inspection | `0a86a4b43fc9173d0cd6bb49da93bf77f0d4bdd6` | metadata only; not the candidate |

This freeze is honestly **post-source-commit**, not a pre-candidate control set.
It is **pre-independent-implementation-inspection and pre-independent-execution**.
Controls were derived from the declared API/profile, native evidence and official
Bash documentation. They are not blind to the author's specification/evidence and
are not claimed to invent previously unknown semantics. No product source blob,
implementation diff, author helper/test body, emitted JS/declaration, or private
repository was read. No candidate or native Bash binary was run. No accidental
candidate implementation exposure occurred. The required historical REPORT's
opening sections contain descriptions of preexisting runtime seams and proposed
integration; those descriptions were seen as documentation, not implementation
code, and do not authorize inspecting or modifying those runtime files.

Private seam: `src/shell/getopts.ts` exports `createGetoptsState`,
`cloneGetoptsState`, `withGetoptsIndex`, and asynchronous `scanGetopts` internally.
The name is `scanGetopts`, not an invented `asyncscanGetopts` export. Only the
declared profile was read. Source SHA256 in `proof-procedures.md` is an author
claim until independently checked after resume.

## Consulted material, exactly

Applicable instructions read: `../AGENTS.md` (root delegates, leaf implements) and
repository `AGENTS.md`; no applicable nested instruction files were present at
the checked `tests`, `tests/shell`, author getopts or owned directory levels.
The user assignment is the current ownership authority. Instructions were not
created or edited. The owned directory did not exist at initial inspection.

Declared API/profile and evidence read from these exact local paths:

1. `tests/shell/getopts/AUTHOR_HANDOFF.md` — public scope of the private seam,
   author accounting, cancellation contract and withheld integration.
2. `tests/shell/getopts/README.md` — frozen API, bounds/work units, Unicode policy,
   independent active cursor, reset/clone rules and root readonly policy.
3. `tests/shell/getopts/evidence/freeze.json` — pre-candidate author freeze identity.
4. `tests/shell/getopts/evidence/scanner-facts.json` — metadata, fixture inventory,
   projected scanner operations and exclusion inventory. Detailed review focused
   on clusters, markers, errors, required values, reset, larger indices, changed
   vectors, shortened active tokens and active-slot/index separation. Long output
   was sometimes terminal-truncated; this is not a claim of reading every byte of
   all 76 observations or independently rerunning that cohort.
5. `tests/shell/getopts/evidence/design-v1/archive.json` — all 21 entry names,
   exact encoded lengths and SHA256s independently checked with Node builtins,
   without importing or executing any archived driver. Decoded in memory only:
   `REPORT.md` opening lines 1–125 and 115–166 (including measured behavior table),
   `identities.json`, `docs-fetch.json`, and selected raw records below.
6. `tests/shell/getopts/evidence/phase1-validation.json` — author claims, five
   source/test hashes, test/type/build command metadata and artifact inventory;
   no listed product/test file was opened or run.

Archived raw material inspected: schemas/first records of `raw.json`,
`followup-raw.json`, `ordering-raw.json`; Bash5.3 stdout/stderr for
`clusters-arguments`, `markers`, `missing-silent-errors`, `same-index-reset`, and
`optionstring-edges`. Other cursor facts were read through authenticated frozen
projection records and the report, not claimed as fresh native runs. All original
124 native observations remain untouched: 88 base +24 followup +12 ordering,
62 per profile. Original source/driver data were hashed as opaque archive bytes,
not decoded as implementation or executed. No archived driver was inspected.

Official primary online source consulted through `web.run` on August 27, 2026:
GNU Bash Reference Manual, section 4.1, “Bourne Shell Builtins,” `getopts` entry,
at `https://www.gnu.org/s/bash/manual/html_node/Bourne-Shell-Builtins.html`.
The equivalent `/software/bash/` URL was searched first. Direct `open` requests
returned no readable body; a later targeted web search returned the official
entry text, which was read. The manual landing/full manual search identified
Edition 5.3 (updated May 18, 2025). No secondary technical source was relied on.
No local byte-perfect copy or hash of the fetched web page is claimed. The author
archive's prior failed GNU fetches remain failures, not silently relabeled.

Paraphrased manual basis: optstring declares options and required arguments;
OPTIND needs explicit reset between parameter sets. EOF is nonzero with `?` as
the result. Leading colon changes invalid-option/missing-argument outputs;
OPTERR=0 suppresses diagnostics without changing normal mode to colon mode.
Question mark and colon are not valid option characters. Explicit operands can
replace positionals. Cluster cursor behavior and changed-vector rules here come
from the declared Bash5.3 evidence/profile, not an assertion that POSIX specifies
those extensions. Stronger readonly protection and ASCII-only option parsing are
explicit project boundaries, not native equivalence.

The manifest authenticates six local consulted API/evidence paths and the
applicable instructions by their observed SHA256s. This authenticates the read
documents, not the candidate implementation or current whole product.

## Frozen controls and denominators

| Artifact | Frozen units | Meaning |
| --- | ---: | --- |
| `semantic-controls.mjs` | 31 sequences / 85 scan projections / 5 explicit index events | Expected scanner result objects, not executed tests |
| `native-holdouts.sh` plus native mapping | 12 script selections / 71 projected records per profile | New scripts, unexecuted; Bash5.3 acceptance and separate 3.2 history |
| `policy-controls.json` | 32 named controls | State, malformed inputs, Unicode, caps, checkpoints, cancellation, cleanup, purity; several explicit matrices |
| `type-probes.json` | 2 positive / 26 negative probes | Strict source and relocated-declaration consumers, not compiled yet |
| Mutation targets | 16 | Named discriminating mutations, not executed/killed |
| `proof-procedures.md` | 8 procedures I01–I08 | Identity, immutable archive, source/package/load proof, types, native runs, mutation, cleanup |

Do not add overlapping denominators. Native records reuse selected semantic
expectations; they are not 71 more independent controls. Policy matrices are not
expanded into an invented total test count. A harness added after resume must
report its exact materialized subcases separately. All candidate/native/type/
mutation execution counts in this freeze phase are **zero**.

The 85 projections compare every result field except opaque internal state;
P01–P05/P30 separately constrain state ownership and transition behavior. Expected
state progression must be obtained by actual scanner calls, never reconstructed
from the expected projection. Error intent differs from emitted diagnostics; the
native wrapper additionally freezes exact stderr. Native scripts are explicitly
development oracles, not product host IO/stdin/VFS support.

Small private representation questions remain documented, not silently invented:
whether no active cursor is represented by null or absence; diagnostic behavior
for malformed signal objects where not explicitly documented; stronger rejection
of malformed reserved-character optspec declarations. These do not block this
control freeze. Resolve them from declarations/documentation after resume and
retain any ambiguity as such; do not change meaningful frozen behavior to fit
the implementation. Runtime cap/count/ASCII/clone/cleanup requirements are not
waived by those representation questions. Native binary availability and actual
relocated-package feasibility have intentionally not yet been tested.

## What was independently done, and what was not

Independently done: instruction/API/evidence reading; commit metadata resolution;
archive-member byte-length and SHA256 checks for 21 entries; primary-document web
consultation; authoring/structural checks of only these new independent controls;
and the explicit-path freeze commit. Fixture-only verification imports no product.
The manifest verifier never launches Bash, TypeScript, candidate code or drivers.

Author-reported, NOT independently reproduced here: 134/134 tests twice (134
distinct tests, not 268), 36 fixture tests with 76 projections from 17 Bash5.3
scripts, retained 124 original observations, strict typecheck/build and two-call
compiled private consumer. The other 97 author helper tests were post-candidate.
No full-product/current-live gate, service acceptance or public package gate is
implied by those reports or this freeze.

Foreign staging was empty at initial inspection; many foreign untracked paths
were present and left untouched. Recheck index metadata immediately before/after
the atomic `git commit --only` with explicit owned files. No reset, stash, broad
stage, branch or whole-tree preservation claim. Concurrent foreign commits may
change HEAD without changing the candidate identity above.

## Stage 2 remains WITHHELD

No usable builtin, variable writes, readonly bypass or attribute removal,
registration, default-command count increase, assignment-origin hooks, local or
function-entry cursor restoration, positional/subshell/invoke lifecycle, shared
shell-budget wiring, or output integration is accepted here. Root's stronger
readonly policy is mandatory. `src/shell/runtime.ts` and `src/shell/shell.ts`
remain exclusively Sagan's owned-output rebase. No Linux claim, full getopts/native
parity, just-bash superiority or product completion is made. Genuine candidate
bugs found only after authorized resume must be reported to root, not fixed in
product by this reviewer.
