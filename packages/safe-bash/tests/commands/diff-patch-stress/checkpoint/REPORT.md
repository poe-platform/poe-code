# Frozen diff/patch checkpoint — August 26, 2026

## Identity and scope

Verified **`b92841a8ceaba9fb1f9c8c7915e218f880a9d1ed`**, not later HEAD.
The fresh `git archive` extraction is preserved at
`/tmp/safe-bash-diff-checkpoint-Fpgf5L`; raw outputs, archive, manifests,
commands, oracle identities and machine-readable results are preserved outside
that snapshot at `/tmp/safe-bash-diff-checkpoint-Fpgf5L-evidence`.

- Archive SHA-256: `1c3f142a4a4cfa88abb8282dc2a1b04f221664f9c8a4420777a9a58ba0aea42e`.
- Diff/patch subtree SHA-256: `e44828bbc404cffbb077545fa628e3928436429bf79a67dd7ad47cd85ce942d9`.
- All 543 archived files have identical before/after SHA-256 manifests.
  `checkpoint.json` records scoped file hashes and the aggregate algorithm.
- Only the correct-root existing `node_modules` and
  `benchmarks/node_modules` installations are symlinked; nothing was installed.
- Source, filesystems, benchmark harnesses, manifests and existing tests were
  read-only. The build adds `dist` only inside the snapshot. No delegation.
- Pending diff/patch source changes were captured separately before testing;
  pending author-test paths were captured in status, not imported into the archive.
  In particular, later `6e1240ef82679996c2a6ba9a3566ec6a38f6e5a9`
  (`-E`/remove-empty and creation into existing empty targets), and subsequent
  documentation commits `b0446d6`/`a3a1b8d`, are **excluded**.

## Results

| Frozen suite | Pass | Fail | Total | Skip |
| --- | ---: | ---: | ---: | ---: |
| Author diff/patch | 813 | 0 | 813 | 0 |
| Independent formats | 1,055 | 14 | 1,069 | 0 |
| Parser regressions, unmodified combined assertions | 75 | 5 | 80 | 0 |
| Compatibility | 101 | 9 | 110 | 0 |
| Fuzz node tests | 34 | 2 | 36 | 0 |
| Safety, including corrected explicit-target assertion | 151 | 0 | 151 | 0 |
| Path regressions | 619 | 0 | 619 | 0 |
| Edit flows | 31 | 0 | 31 | 0 |
| Absolute target, including both GNU native tests | 30 | 0 | 30 | 0 |
| **Distinct suite-test total** | **2,909** | **30** | **2,939** | **0** |

Cancelled and TODO counts are zero. These totals retain every failed native and
profile gate. Repeated formats execution and the initial parser hook failure
below are recorded separately, not double-counted in this distinct-test total.

- **Pure parser product acceptance: 76/76**, zero product issues, failures or
  skips. This includes the seven requested regressions. It is a separate
  projection of those fixtures, not a replacement for the failing 80-test matrix.
- **GNU fuzz properties: 7,168/7,168**, zero failures/skips: 512 cases, 14
  properties per case, seed `1831565813`, all 16 families. Both native-native
  directions and all cross-tool/golden/minimality properties ran; no index filter.
  These properties are nested in one of the 36 fuzz node tests, not additive.
- Strict scoped TypeScript over all diff/patch source, author tests and independent
  stress TypeScript: **exit 0**. Compatibility runner's scoped check: **exit 0**.
- `npm run build`: **exit 0**; no unrelated build errors occurred. This is not a
  claim that whole-repository tests or whole-repository test typechecking passed.

## Remaining failures — no exemptions

No new product defect was found relative to the supplied baseline. Known GNU
behavior differences remain product compatibility gaps, not successes:

- Formats: **3** repeated-context-selector GNU-profile disagreements; **6**
  GNU-diff/GNU-patch zero-context native-native failures; **5** cross-checks
  blocked by independently failing Apple reverse controls (`ORACLE BLOCKED`).
- Parser: **5** native-only failures: `normal-tab-prefix`,
  `normal-suppress-blank-empty`, `normal-unsafe-integer` (bounded native timeout),
  `GNU-normal-suppress-blank-empty`, `GNU-context-zero-middle-deletion`.
  The three product-bearing failed assertions each report `productIssues: []`.
- Compatibility: **9** repeated-context-selector/maximum-context comparisons,
  including the Shell flow. Expectations remain unchanged.
- Fuzz: **2** standalone failures: legacy Apple-range reverse interpretation
  versus GNU, and asymmetric non-EOF boundary anchoring (product applies a patch
  that GNU rejects). Neither is waived by the passing 7,168-property corpus.

One initial parser run attempted an external `PARSER_EVIDENCE` destination. Its
existing after-hook rejects paths outside its own subtree: **75 pass / 6 fail /
81 total**, including that extra verifier-invocation failure. No file was written
there. The corrected run leaves `PARSER_EVIDENCE` unset and executes the unchanged
test directly, yielding **75/80, five native failures**. Both raw outputs are
retained; the separate read-only product projection writes evidence externally.
The original parser runner was inspected but not executed because it writes
evidence into the test subtree. No harness was edited to redirect its writes.

## Public package and comparator

Fresh built-package self-import resolves to this snapshot's `dist/index.js`.
The old `/tmp/safe-bash-diff-package-l0rs/package-checkpoint.mjs` verification
logic was rerun, changing only its artifact-directory constant in memory:
**14/14**, zero failures, zero host-process attempts. Its old results were not
reused. Original and executed-script SHA-256 values are preserved externally.

Root exports and emitted declarations verify:

```ts
createDiffPatchCommands(options?: DiffPatchOptions): readonly CommandDefinition[]
diffPatchCommands(options?: DiffPatchOptions): VirtualShellPlugin
```

The **actual frozen comparator fixture** `plugin-diff-patch-roundtrip`, case
**113 of 118**, was additionally imported read-only and executed with the built
public `Shell` and public command plugins. Its literal `patch /fixture/old`
command passes exact exit, stdout, stderr and complete file-byte comparisons:
**1/1**, zero host-process attempts. This is distinct from merely calling the
private command implementation or substituting a similar fixture.

The unchanged full comparator also ran: **118 cases per engine**, virtual-bash
**118 pass / 0 fail**, pinned and installed just-bash **3.4.2: 108 pass / 9 fail /
1 unsupported**. Overall exit **1**; no pending/error/timeout results. Source and
harness fingerprints remained stable, with no worker background errors. The
archive has no `.git`, so comparator Git revision fields are null; archive and
source hashes plus the external frozen Git metadata bind it to the commit above.
The full comparator uses source imports; the separate case and 14 smoke checks
are the built-public-package proof. Unsupported outcomes remain in denominators.

## Reproduction and raw evidence

Use the preserved snapshot, Node `v22.22.2`, and its existing dependency symlinks.
Set `GIT_DIR` to the artifact directory's `frozen.git`, `GIT_WORK_TREE` to the
snapshot, and the following explicit oracle overrides:

```sh
export DIFF_WHITESPACE_ORACLE=/tmp/safe-bash-gnu-oracle.Yg2F0W/diffutils-3.12/src/diff
export DIFF_PATCH_NATIVE_DIFF="$DIFF_WHITESPACE_ORACLE"
export GNU_PATCH_BINARY=/tmp/safe-bash-gnu-oracle.Yg2F0W/patch-2.8/src/patch
export DIFF_PATCH_NATIVE_PATCH="$GNU_PATCH_BINARY"
export SAFE_BASH_GNU_PATCH="$GNU_PATCH_BINARY"
unset DIFF_PATCH_FUZZ_INDEX PARSER_EVIDENCE
```

GNU identities are Diffutils **3.12** and patch **2.8**, with executable hashes
in `checkpoint.json`. Formats/parser helpers also pin their paths directly;
explicit Apple controls and edit-flow native tools are not relabeled as GNU.
Native calls retain their harness bounds (2–3 seconds and output caps); outer
suite invocations were also bounded. No unavailable oracle was silently skipped.

`suite-runs.json` and `validation-runs.json` preserve literal argv and statuses;
`formats-full.stdout`, `parser-regressions-corrected.stdout`, and
`compatibility.stdout` preserve full failing diagnostics. The formats runner
also ran separately with the same 1,055/1,069 result. `reconciliation-report.json`
includes all 14 fuzz property counts and an empty failure index.
`parser-product-acceptance.json`, `package-checks.json`,
`public-actual-comparator-case.json` and `full-comparator.json` retain detailed
results. `checkpoint.json` hashes these principal artifacts.

This checkpoint neither validates later writes nor establishes universal utility
compatibility, full-shell completion, superiority, or 72 hours of work.
