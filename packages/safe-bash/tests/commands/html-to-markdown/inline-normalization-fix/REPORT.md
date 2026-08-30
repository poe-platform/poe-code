# Closed author handoff: semantic inline normalization

Source writes are closed for Meitner's separate final review. This is author
verification only, not independent acceptance, root/public integration, a global
gate, superiority over another implementation, or completion of 72 hours.

## Candidate and ownership

- Expectation freeze: `d157a9e0` (full ID in SUMMARY.json).
- Source/new-regression commit: `9ae34a06662db27897043d77d6145700c109b22c`.
- Full candidate tree: `38c79be99f9b8713fe669262acc2ddd0d4432320`.
- Full source tree: `8241c2c59cc7240e6543bfef4619dc9ea1fe8aa2`.
- HTML source tree: `655419edcf7d592071847b8a10cfdf0587d3e64d`.
- Baseline HTML tree: `bbc3af91338fd21c5b9b5d2a045f2d3d6e358921`, identical to
  source `3ef5811f98d61800b6d4c6f16be046d4f539eeef`.

Only `src/commands/html-to-markdown/render.ts` and its README change product
source. The full baseline-to-fixed source diff contains exactly those two paths;
all other compiled source inputs remain unchanged. Foreign live edits, including
shell work, never enter the committed archive. Root exports, package manifests,
contracts, runtime, filesystems, existing tests and independent evidence are
unchanged by this leaf. No shared discovery settings or budgets are changed.

The module-local factory/plugin API remains unchanged. Normalization removes
zero-output inline wrappers, exposes inactive labels/transparent children, and
coalesces equivalent rendered styles, including the child boundary created by
coalescing parent styles. Contextual escapes and delimiter selection consume
these sequences rather than raw sibling positions. Whitespace, meaningful
breaks, nonempty code, and active links/images remain boundaries. Empty active
labels are not treated as absent atoms. Empty destination attributes retain the
existing inactive-label policy.

Visits, retained reference slots, whitespace classifications and destination
scans use the existing charged work/checkpoint machinery before growth. Cached
sequences and append-only merging avoid accumulated-prefix concatenation and
flattened arrays at every empty/transparent wrapper. Nonempty nested formatting
still has depth-dependent work under the unchanged cap. The parser retains its
tree and bounded output: this is not HTML5, a sanitizer, or constant memory.

## Frozen expectations and results

CASES.json contains 34 cases frozen before the first source edit. Its first ten
inputs/runs exactly match immutable NEIGHBORS.json: seven minimal failures and
three controls. CASES.json is unchanged from the prep commit. Additional cases
cover split numeral chunks, aliases, empty unknown/inactive wrappers, text and
whitespace boundaries, punctuation, code, links and images.

NESTED.json adds three child-boundary invariants, frozen after the first source
pass but before its recursive-coalescing refinement. These are explicitly not
pre-first-patch expectations. All three fail on the archived original source
and moved package. The first-pass development replay also retains its three
failures; none of the 34 original expectations was rewritten.

| Cohort | Archived original source | Original moved | Fixed source | Fixed moved |
| --- | ---: | ---: | ---: | ---: |
| Original ten neighbors, AST | 3 pass / 7 fail | 3 / 7 | 10 / 0 | 10 / 0 |
| All 34 frozen cases, AST | 17 / 17 | 17 / 17 | 34 / 0 | 34 / 0 |
| All 34 frozen exact Markdown assertions | 11 / 23 | 11 / 23 | 34 / 0 | 34 / 0 |
| Supplemental nested three, exact output | 0 / 3 | 0 / 3 | 3 / 0 | 3 / 0 |
| Supplemental nested three, AST | retained original ASTs | retained original ASTs | 3 / 0 | 3 / 0 |
| Unchanged author 22 AST assertions | 22 / 0 | 22 / 0 | 22 / 0 | 22 / 0 |
| Unchanged author 55 product probes | not part of initial baseline | not part of initial baseline | 55 / 0 | 55 / 0 |
| Unchanged independent 28 stress recipes | historical evidence retained | historical evidence retained | 28 / 0 | 28 / 0 |

AST assertions check paragraph-versus-list structure, visible characters and
style nesting; meaningful-atom cases additionally check Link/Image structure
and exact Markdown. Pandoc 3.10.1's pinned `commonmark+strikeout` reader is a
development oracle only. Strikeout is an extension; this is not the old
`commonmark_x` smart-typography profile or arbitrary Markdown dialect parity.
The historical Pandoc HTML conversion comparison remains **5/16 exact and 11
different**, unmodified and unrescored. Raw `author22.exactPass` counters in the
capture mean successful conversion, not a separate exact-Markdown assertion;
the actual author22 oracle is the checked character/style AST.

The frozen archive also passes all **154 unchanged author tests + 52 new tests**,
strict scoped source/test types, a 36-source-file module-closure build, and
positive/three intentionally invalid declaration consumers in both layouts.
The new tests include long empty chains, nested wrappers, ragged adjacency,
linear empty-chain work scaling, direct normalization work refusal, unchanged
depth/token/node/output caps, controlled in-flight cancellation, backpressure,
and accepted-prefix behavior after a sink failure.

Unfrozen development runs separately passed 206 tests, 55 probes and 22 AST
checks. Their logs are retained but are not the frozen acceptance evidence.
No global build/typecheck/test gate was run; foreign errors were not repaired.
The evidence diff whitespace check reports twelve whitespace-only lines emitted
by node:test in the captured pre-refinement failure TAP. Those raw bytes remain
unchanged; this is not a source-formatting failure or a whitespace-rule waiver.

## Existing fixes and cancellation

F01/F02 are exercised by the unchanged bounded stress recipes, eight charged
direct-work checks per layout and four controlled scan-aborts per layout.
No cap is raised. The older stress fixtures retain their existing explicit
limits; new normalizer stress uses defaults or deliberately smaller limits.

F05 preserves the separately frozen v2 policy: the two undersized entity cases
return status1, empty stdout and exact token-bytes EFBIG diagnostics at every
byte split. Their old status0 expectations and results remain historical
failures, not relabeled passes. The original 125-profile review is not rerun or
called green. F06 preserves edge-control refusal before trimming; the unchanged
edge-control driver passes in both layouts. No active-scheme bypass is claimed.

The fixed capture has **366 supervised receipts**, all natural settlement, with
zero forced terminations and each process group absent at its close receipt.
It includes **24 controlled exact-reason aborts**:

- 12 unchanged render-stage observations: trim/destination, three repeats each
  in both layouts, admitted input/EOF/render entry before the queued abort.
- 4 additional normalization-stage workload observations across both layouts.
- 8 unchanged charged scan observations across both layouts.

Each trigger occurs while the operation is unsettled, rejects with the identical
reason, and settles naturally below the existing observed 1000ms bound. Events,
work counters, PIDs, deadlines, iterator finalization and cleanup counts are raw
receipts, not inferred from a timer. Both obsolete 100ms observations classify
as `natural-fast-completion-NOT-abort-coverage`. No-trigger/pre-abort controls,
host-I/O denial controls and strict-type negatives are separate. These are
cohost-dependent observations, not universal timing or performance guarantees.
All owned capture/verification processes have exited naturally; no worker was
paused, stopped, or killed for a checkpoint.

## Full archive and actual moved package

The fixed run materializes all **34,532 regular files** from the actual full
committed candidate, without live overlays, cherry-picked product inputs or
workspace aliases. Twelve tracked native-fixture symlink entries are enumerated
as nonregular and not materialized; the retained Git tar includes their metadata.
Every regular file's Git blob and SHA256, and full membership including added
entries, are verified before and after execution. The fixed tar hash is checked
before and after as well. Baseline regular blobs/membership receive the same
checks; its tar SHA256 was recorded after execution, not falsely preattested.

Compilation uses the archive's actual dependency closure and copied, hashed
development tools. `npm pack --offline --ignore-scripts`, an actual isolated
offline installation, and a physical package-directory move all execute. The
144 emitted files in the installed/moved package match the compiled bytes. The
package has zero runtime dependencies. This is the previously validated
**module-local closure profile**, not a complete public-export package build.

The actual load audit records **5,832 product module loads**, checking each
loaded URL/hash against the source-emitted or moved package inventory. Node's
permission boundary excludes the candidate source and live workspace during
product replay; the original host-I/O denial loader is reused unchanged.
The unchanged entry hash alone is not evidence of the fix: the loaded renderer
hash below identifies the new implementation. Across baseline and fixed builds,
only renderer JS/declarations and their two maps differ. Map hashes/location
information are retained; no universal output/map byte-identity claim is made.

| Binding | SHA256 |
| --- | --- |
| Fixed full Git tar | `75dbe350f40a217d4d37519a3faa9445e55917f344621bc2fe70536ef4d3adbd` |
| Baseline full Git tar | `54e25d97608d8fbb875aecb122b3d0735fc66a9708f0f2eb7b06f60d10970eb9` |
| Fixed actual package | `aed5586e0e11880d3734fb788f124ccc55cae905b57d01a24bc754da107c325d` |
| Baseline actual package | `5d6a3dc3f597d935fc10206ab3a6eb75f0a218b6103525ef1a8d141eebd7d608` |
| Renderer TypeScript | `a624213e0289a441f1cacbf128dbac0861d23aee0ca3d7a2ad2f98a1d5da6378` |
| Loaded renderer JS | `0a896b93afea9240e3616d1eccc0cf8df5f8b88305b4f157a700f991af241727` |
| Loaded entry JS | `08adabfb1f5eeee7910963352ae8d374598d0bf73bcf2ccf224d794e58ab7234` |
| Lockfile | `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b` |
| TypeScript compiler implementation | `e8f349eabd48486bdb2bf9dc1a00c89d58297270c54b745838879e2859194419` |

Node 22.22.2, npm, TypeScript 5.9.3, @types/node, undici-types and Pandoc match
the prior authenticated review's tool bytes/inventories. The compiler launcher,
all actual compiler inputs, package entry/declarations, copied tools and lock
records have separate hashes in the raw data. tsx/esbuild are lock-version
checked and fully hashed, not newly fetched or claimed freshly registry-audited.

## History, storage and verification

Three initial setup attempts are preserved:

1. A tab-bearing native fixture filename exposed a Git-list parser split bug.
   Membership verification stopped before compilation/product execution.
2. Copying tool symlinks without `verbatimSymlinks` created external targets.
   Tool-containment verification stopped before compilation/product execution.
3. TypeScript treated imports under the isolated `node_modules` data tree as
   external libraries and omitted imported JS emission. Actual package replay
   failed at module import, before command execution. Explicitly listing the
   archived transitive closure fixed the harness without changing product input.

All failed scripts, raw errors, attempted packages and natural-settlement
receipts remain. Attempt04 is the passing baseline; no earlier attempt is
backfilled as successful. The first-pass nested-style failures also remain.

EVIDENCE.json.gz.base64 is an encoded, lossless file map of **4,237 evidence
files**, authenticated by MANIFEST.json. SUMMARY.json cross-links counts,
tool/package/source bindings, phase receipts, source paths and archive hashes.
Large full candidates/tars and tools remain locally available under the owned
HTML module's ignored `node_modules` subtree. The earlier baseline materialized
trees were relocated there after natural completion, with their source bytes,
membership and successful tools/package reverified. RELOCATION.json preserves
the original-to-retained path mapping; old absolute receipt paths remain
historical, not aliases. This keeps captured TypeScript/native data outside
canonical `tests/**/*.test.ts` discovery without any shared exclusion change.
The separate config-discovery log also confirms zero captured candidate inputs
in the root build and both scoped configurations; it is not a global typecheck.

Read-only evidence verification, optionally rechecking retained full trees:

```sh
node tests/commands/html-to-markdown/inline-normalization-fix/verify.mjs
node tests/commands/html-to-markdown/inline-normalization-fix/verify.mjs --live-retained
```

Explicit new capture, requiring the same committed driver bytes and available
locked local development tools/Pandoc; never overwrites an existing capture:

```sh
node tests/commands/html-to-markdown/inline-normalization-fix/capture.mjs 9ae34a06662db27897043d77d6145700c109b22c fresh-author-replay --extended
```

The first recorded setup starts August 27, 2026 at 20:36:29.764Z. The fixed
archive run spans 20:48:55.140Z–20:51:29.629Z; later seal/verification timestamps
are recorded separately. These are actual logged intervals, not a duration or
72-hour completion claim. Meitner now owns the separate final review decision.
