# Independent qualified actual-source review — 2026-08-27

**Scoped result: HOLD / qualified partial success, not an expr release gate.**
This is a different verifier leaf, with no redelegation. Only this new evidence
directory was owned. Product, public exports, existing fixtures and evidence were
read-only. Later live changes or fixture repairs do not rescore this candidate.

## Exact immutable inputs

- Actual candidate: `4f01c1593486c1abff3b007f9a3b16923b88559f`.
- Named encoding source: `246aa440c988d6c09464480956c4eff69009f7e4`.
- Inactive-prefix source: the candidate's single `if (!active) return zero;` line.
- Grammar-only ancestor: `be72c9c86c1a6cb00a0b14d86a7f3f8eb7b6c5e7`;
  its parent is `ed21ae6c214e9b76d3361004ce6097c2be5b7136`.
- Named prefreeze: `47309c0be322f685431e2b6579edd86d56b79fdd`.
- Sequencing prefreeze: `e9ff18dcdd403c68550c9ad9ea69d2edce5403a3`.
- Repeat evidence-only commit: `c433d0230468889e825dfff680a5a729b45bd272`.
  **No repeat patch was applied.** Its commit changes no `src` paths. The actual
  BRE worker and four shared regex modules equal the accepted
  `21220b465537bf45ffcfb36740956a69f43bf75e` baseline byte-for-byte.

Every declared archived file was checked against the exact candidate Git blob.
Every entry present at each prefreeze commit was independently authenticated.
Later files in the candidate's design directories are listed separately, not
retroactively called prefreeze inputs. Historical named10 is the unchanged
`c-profile-gap-review/frozen/CASE_MATRIX.json` named category, including its
original mismatch records.

## Distribution and integrity

- Selected committed archive SHA256:
  `5c0df5bd08e85c9bb6f8f110a284fd925e99ba0d5b4d692f73dcdfae846ab271`.
- Packed artifact SHA256:
  `ef02d05362be8b61323f8c5ec304119456d0d00f45ad21c9e676c1c20e5db27a`.
- Isolated source build uses strict TypeScript and `--skipLibCheck false`.
  Scoped source/test typecheck and moved installed declaration consumer pass.
- `npm pack --ignore-scripts --offline`; install uses `--ignore-scripts --offline
  --no-audit --no-fund --package-lock=false` and its own initially empty cache.
  The consumer is physically moved after installation. Installed `src` is absent;
  runtime dependencies are empty. Development TypeScript/Node types are explicit
  external tools, not product runtime dependencies.
- Runtime imports actual installed `dist/commands/expr/index.js` by physical
  path. It does not prove a root or public expr subpath export. Dynamic import
  guards confine product modules to that install or Node builtins; actual worker
  URLs and the four-file static worker import closure are recorded.
- Complete before/after inventories: archive **455** entries before build,
  source **286** entries / **246** files, compiled **860** entries / **820** files,
  installed **862** entries. Original archive contents are unchanged; only
  declared `dist` build additions occur. Source/compiled/installed equality
  checks enumerate new entries as well as original paths. Tar and pack hashes
  are rechecked. This is observation-time integrity, not a transaction or proof
  against arbitrary transient host mutation.

## Results, without merging denominators

| Cohort | Actual result | Qualification |
| --- | --- | --- |
| Frozen sequencing | **42/61**, 19 RED | All 44 GNU + 17 project cases unchanged |
| Two inactive-prefix controls | **2/2** | Included in 61, not added to denominator |
| GNU sequencing portion | **25/44** | Remaining 19 are encounter-order failures |
| Project sequencing portion | **17/17** | Includes admission, cancellation and shared budget |
| Sequencing actual Shell | **3/5** | Separate frozen selected workflows |
| Original named10, user policy | **10/10 direct + 10/10 Shell** | Nine scalar successes and one explicit comparison refusal |
| Same candidate vs actual GNU named10 | **9/10 strict** | Comparison refusal is NOT a native pass |
| Named design MODEL | **14 selectors + 517 admissions** | Model checks alone are not product proof |
| Actual product admission gates | **517/517** | Same frozen environment/pattern/operation data |
| Selector runtime realizations | **14/14 pairs** | New argv probes of frozen selectors; not additional prefreeze argv holdouts |
| Runtime admission realizations | **517/517** | POSTCANDIDATE argv adapters for operation-only sketches; admission, not full regex semantic parity |
| Frozen C diagnostics | **9/9 strict** | Inputs and assertions unchanged |
| Frozen diagnostics runtime | **11/12** | `syntax-output-one` remains literal RED |
| Reused core controls | **146/146** | Unchanged assertions, recorded binding-only changes; independently executed, not independently authored |
| Canonical legacy expr source cohort | **240/241** | One obsolete en_US length assertion preserved |
| Additional author source tests | **221/225** | Four stale unsupported-locale diagnostic assertions preserved |
| Shared grep/rg/regex cohort, final qualified run | **276/276** | Exact eleven files; zero skipped/cancelled/todo |
| Grammar parent assertions on installed candidate | **71/73** | Original two RED assertions retained |
| Grammar corrected assertions on installed candidate | **73/73** | Only `[]` and `["--"]` expected diagnostics changed |
| Initial independent postcandidate supplements | **17/23** | Six verifier assumption errors retained, not product failures |
| Moved-runtime supplemental checks | **13/13** | Includes six newly corrected preabort checks and direct compiler guard |

Host-locale C and en_US.UTF-8 runs produce identical parsed named-runtime
results with explicit virtual environments. Only exact `en_US.UTF-8` is newly
admitted: aliases, casing/spacing variations and unrelated names remain refused.
LC_ALL/category/LANG/nonempty/default-C precedence is exercised. Expr source has
no ambient `process.env`, Intl, child-process or host-filesystem imports.

ALL unescaped bracket expressions, including literal sets, are conservatively
refused when either relevant category is outside the baseline bracket profile.
This does **not** mean every bracket expression is inherently locale-sensitive.
Mixed categories, escaped brackets and odd/even escapes are covered. Direct
production gate probes verify pattern/subject byte limits before indexed scan or
scan charging, exact-boundary scan charging, remaining worker allowance after
screening and worker-reported work charged on return. Positive invocation probes
verify cleanup registration before worker acquisition and cooperative cleanup
before settlement; frozen tests cover cancellation-reason identity and zero-job
short circuits. None asserts universal waiting for opaque/uncooperative work.

## Remaining literal REDs

The 19 sequencing failures are: `root-counterexample`, `modulo-trailing`,
`noninteger-trailing`, `left-error-before-next-operator-missing`,
`left-error-before-next-same-precedence`, `left-error-before-skipped-syntax`,
`group-runtime-before-missing-close`, `group-runtime-before-wrong-close`,
`nested-runtime-before-close`, `prefix-first-argument-before-missing-second`,
`prefix-second-before-missing-third`, `regex-error-before-trailing`,
`regex-error-before-close`, `regex-error-before-later-missing`,
`regex-prefix-error-before-outer-arity`, `regex-success-before-trailing`,
`regex-success-before-missing-close`, `regex-success-before-runtime`, and
`first-regex-before-second-syntax`. Exact argv, expected/actual bytes/status,
job counts and traces are in `sequencing-unchanged.json` and
`sequencing-summary.json`; the early issue receipt identifies the complete-parse
before-evaluate path at `src/commands/expr/index.ts:35` and `syntax.ts`.

`syntax-output-one` uses argv `["1","x"]` and exact options
`{limits:{maxOutputBytes:1}}`. Its unchanged assertion expects status **2**,
empty stdout, and **44 bytes**:
`expr: syntax error: unexpected argument 'x'\n`.
Actual is status **3**, empty stdout, **34 bytes**:
`expr: output bytes limit exceeded\n`, with zero workers. The separate old-cap
sequencing control reproduces the same RED; it is not a new independent failure.

`tests/commands/expr/contracts.test.ts:40` still expects en_US `length abc` to be
unsupported; actual status is 0 versus asserted 2 at line 43. It is obsolete but
unauthorized to edit, so remains one canonical failure. Four active unknown-locale
rows in `inactive-prefix.test.ts:123` still assert the old character diagnostic at
line 127. All refuse with status 2, but the candidate's diagnostic names qualified
en_US encoding. These are four additional unchanged author-test REDs; later
fixture repairs are outside this review.

The grammar audit proves the entire array-literal input inventory unchanged and
exactly one conditional assertion replacement selecting only `[]` and `["--"]`.
Every status/stdout assertion and all other invalid-case stderr assertions remain
unchanged. Historical **239/241** evidence is preserved, never rewritten green.

## Native qualification, attempts and cleanup

Authenticated GNU coreutils **9.7 on Darwin**, binary SHA256
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
Version, linked libraries, host, locale/charmap/scalar prerequisites and Apple
binary identity are recorded. The authorized read-only oracle symlink and every
added parent entry are declared and removed. GNU native replay matches **44/44**
sequencing expectations and **9/9** diagnostic expectations. Fresh named10 GNU
en_US observations match **10/10** frozen native references, candidate strict
**9/10**. Separate Apple en_US observations match **4/10** frozen GNU references,
candidate strict **3/10**. Both C observations match **2/10** named references;
that is a different environment, not a C parity claim. No Linux substitution.
Fresh raw native observations were ephemeral, hashed and removed, not committed.

`ATTEMPTS.md` preserves two preparation failures, shared **105/110** missing
prerequisites, shared **275/276** ancestor-Git fixture contamination, then
**276/276** with a tsx-cache postcheck error. Final **276/276** uses identical
tests, explicit outside-Git native scratch and disabled development-tool cache;
empty scratch and removal are verified. Six initial postcandidate preabort
supplements incorrectly required registration before nonexistent acquisition;
their TypeErrors remain recorded. The new six moved-runtime probes do not
retroactively change those assertions.

All owned worker cohorts report zero residual workers; contained jobs await
their termination. Full source/compiled/installed postchecks precede removal of
**3586** owned temporary entries. `.work`, the oracle binding and both explicitly
tracked external native scratch directories are absent. Existing other-worker
native directories and concurrent edits are untouched. Validation evidence runs
from 19:33:35 to 19:47:31 UTC on August 27, 2026 (not a 72-hour claim).

These opt-in single-capture drivers use exclusive output creation and are not
canonical test discovery. Re-execution needs a new empty authorized output
binding; do not overwrite this evidence. The complete 2 GB repository and all
TypeScript consumers were not qualified. No whole-expr, public-export, full-gate,
deployed-provider, universal-parity, performance or superiority claim is made.
