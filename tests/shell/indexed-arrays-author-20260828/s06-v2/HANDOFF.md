# Narrow S06 author successor — August 28, 2026

Author proof only. Plato continues the old frozen c7 review; independent
acceptance of this successor belongs to Plato/root. No declaration work,
O11 cleanup inference, native comparison, whole gate or superiority claim.

## Immutable candidate binding

- Product: `c0adae539c736db0e4023d401562ce958d9ebb00`.
- Regression/driver preseal: `0286a6ff0ed46faf00a071736e6bc9e269f63afe`.
- First preseal: `105a2c92`; corrected only the new fixture import in v2.
- Controlled c7 baseline receipt: `a29bea0c`.
- Accepted DOTGLOB tree: `37ad3f94f9fa07037e61d2bd27a4a4b7cddb4d5e`.
- Successor composed source tree: `30f88590b66b88dc9694a56c85f1ee690f02218b`.
- Full 862-file, 787736-byte package SHA256:
  `e12ed19882b6722503a8fb962ca88e0d6c40300a7e76acc3f81aef5961e0a3a3`.

The driver reconstructs all 265 accepted selected base inputs plus exactly four
private array modules, with only parser.ts, runtime.ts and arrays/syntax.ts from
the committed repair. Other c7 source is frozen. It never overlays raw HEAD,
declaration work or unrelated concurrent files. SUCCESSOR-SEAL.json gives every
owned source SHA256/blob, tool version/hash, artifact and load binding.
`successor-capture-01.json.gz.base64` decodes to the complete original report;
its `package.base64` contains the actual packed artifact, not a rebuild recipe.

## Root cause and representation

The parser already emits an empty quoted text entry on every double-quote
opening. It also merges adjacent quoted text. Consequently the public Word.parts
for `"${a[@]}${b[@]}"` and `"""${a[@]}${b[@]}"` are structurally identical.
The old runtime treated that text as a real field contribution. Two zero-member
aggregates then contributed nothing, leaving the invented empty field behind.
Suppressing every empty quoted field would instead destroy S08, scalar empties,
actual empty members and quoted empty-star behavior.

The repair keeps the observable AST exactly as before and records synthetic-only
quote provenance in a private WeakSet in the existing syntax metadata module.
New quote-opening text is marked; opening a quote against existing literal text
does not erase its literal provenance. Actual literal merging and a genuinely
empty quote clear the marker. Text-containing quotes and continuation-only empty
quotes use the same part-count rule, without inspecting particular array inputs.
The WeakSet owns no strong reference to parsed words/parts, has no global name
mapping and introduces no invocation cleanup or public field/type/option.

Existing copyArraySelector also copies this private provenance when lazy
alternates are explicitly cloned. Prefix removal reuses intact remaining parts;
its sliced part has consumed nonempty unquoted assignment syntax and is not a
synthetic quote marker. The runtime consults provenance only for array-owned
word expansion. `present` now means a real literal/scalar/member contribution
there, not quote syntax. Actual quoted-empty members and quoted `*` still create
a field; zero-member `@` does not. Splicing stays left-to-right, not Cartesian.
No scalar-only or positional expansion branch is changed, and existing private
reservation formulas, limits and shared budgets are untouched.

## Observed results, not combined denominators

| Cohort | Unchanged c7 | Successor |
| --- | --- | --- |
| Original source foundation/syntax | 32/32, 69 public execs | 32/32, 69 public execs |
| Targeted 50 argv + one public-AST assertion | 42 pass, 9 fail | 51/51 |
| Original installed public body | 6/6 | 6/6 |
| Original physically moved body | 6/6 | 6/6 |
| New installed S06 consumer | not run | 50/50 |
| New physically moved S06 consumer | not run | 50/50 |
| Same ten loaded original mutants | not run | 10 assertion refusals |

The nine c7 failures are exactly the presealed source predictions, including the
unchanged S06 input. No semantic expectation was revised. The first v1 attempt
instead stopped before runtime on TS2307 in the new fixture import; its build
passed, both child groups were reaped, and its original failure/source remains
preserved. The v2 correction only uses the actual memory/index.js module path.

Successor selected build, strict source/tests, both strict installed consumer
layouts and the unchanged public API negative control pass their expected
outcomes. All 83 ordinary source test groups pass with zero skips/cancellations.
The ten mutants actually load their altered source hash and fail a specific
executed original assertion; none is counted from preload refusal. Those mutant
failures remain separate from normal tests. Existing G4A proof is still logical
private ownership accounting, not whole-command, external E-phase, RSS or total
memory containment. N13 remains historical; no native calls were made.

The original source cohort loads 35 distinct source/test files; new targeted
cohort loads 34. Each public layout records 214 distinct package/app files.
Installed means physical archive extraction to node_modules with actual bare
package imports, not npm install. The moved app is renamed on disk and the old
path is absent before rerunning. No package src tree/source fallback or runtime
dependency is present; dependencies remain empty. Offline pack disables scripts.

Whole package membership is unchanged. Only ten artifact files change: emitted
parser/runtime/syntax JavaScript and maps, plus the private syntax declaration.
All nonprivate `.d.ts` files, root/command/shell declarations and package metadata
remain byte-identical to c7. Source/build and package byte inventories are checked
after execution including new entries; they are not merely original-path checks.

## Preservation and cleanup

The 2-child first transport attempt, 10-child c7 baseline and 22-child successor
all settle; each recorded process group is absent. No integrity, safety or
cleanup failure occurred. Raw attempt archives retain every file byte and mode,
empty directories and the explicit development-link target without following it.
They are gzip/base64 data, never canonical TypeScript inputs. Historical v1 TS
sources are byte-preservingly classified as `.fixture`; their original paths
remain bound to commit105a2c92. No canonical test exclusion or blanket skip is
introduced, and every original author/reviewer test stays unchanged.

The successor driver ran from 14:43:29.298Z to 14:44:08.385Z on August 28, 2026.
This is actual validation timing, not a 72-hour claim. CLEANUP.json records final
verified removal of only these three owned scratch projections after receipt
preservation. Foreign staging, raw artifacts and worktrees remain untouched.
