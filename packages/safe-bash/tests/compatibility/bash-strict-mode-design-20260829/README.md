# Unit 2: clustered `set` and nounset — source-only proposal

2026-08-29. **Implementation and runtime/native validation are not authorized by this packet.**
Public80 c83 is accepted; the separate unit1 redirection candidate is still under independent review. No mutable HEAD source is evidence here. No native/provider version is inferred from the GNU reference edition.

## Binding and current source facts

`BINDING.json` authenticates 19 selected source files from public80 tree `c83f352f057c64917f219eb938f54aa42cdab829`, SOURCE SHA256 `14a2a6a50d7748b677c4cc1261d6f69a411c1c21926c7acd884c86f2077e9450`, accepted by `9dca6b405f7059bd54848422d27a80afdf80e504`. Its full950 package identity is `4671ed60875c87f8cc32b735fde5d9b57301f427ecd5a376ad1123afb951e156`; no package was executed or rebuilt for this design.

Unit1 is separately represented by source `1e9b83d73ca6efcf84e4cb0a0b20d81f71da237e`, derived tree `ed0e0d09cf71bed7f4aee075750b60a30df4ef52`, and the authenticated three-path diff. It is not silently included as accepted source. Unit2 must neither change its operators nor rebase its frozen tests.

All anchors below refer to the **c83 blobs**, not live line numbers:

| Hook | Source fact / implication |
|---|---|
| `src/shell/runtime.ts:188` | State contains `pipefail` and optional `errexit`, no nounset. Add private optional `nounset`; absent means off. |
| `src/shell/runtime.ts:3170` | `set` accepts repeated e-only tokens and exact `-o/+o pipefail/errexit`; mixed `-eu` is rejected. Existing `--`, lone `-`, and positional version tracking must remain. |
| `src/shell/runtime.ts:302` | State snapshots spread scalar state; nounset can inherit without a new public context field. |
| `src/shell/shell.ts:245` | Each public exec creates fresh state. Shell reuse must not inherit a prior exec's nounset setting. No shell.ts edit is necessary if optional-off is used. |
| `src/shell/runtime.ts:2257` | Virtual interpreter process state is newly constructed; options default off. Its c/s/e CLI grammar is separate from `set`; `bash -u` is not included implicitly. |
| `src/shell/runtime.ts:1039` | `variable()` reads scalar or array element zero. This is also used for presence/default tests: do not add a blanket missing-value throw here. |
| `src/shell/runtime.ts:3465` | Array element reads currently coalesce absence to empty; member expansion and member count have separate paths. |
| `src/shell/runtime.ts:3487` | Default/alternative/error operators test presence and nullness before coalescing. Pattern/substring routes currently accept absent values. |
| `src/shell/runtime.ts:3674` | `word()` has an additional lazy default/alternative fast path. Both paths must agree; no eager alternate expansion. |
| `src/shell/runtime.ts:1029` | Arithmetic accesses go through a proxy; array arithmetic is explicitly unsupported. A read-specific nounset check belongs here, not in assignments. |
| `src/shell/arithmetic.ts:174` | Name evaluation recursively reads variables; plain `=` evaluates RHS only, while compound assignment/increments read LHS; logical/conditional branches are lazy. Opaque errors are rethrown at 215. |
| `src/shell/runtime.ts:1493`, `:2853`, `:3435` | Arithmetic command, LET and arithmetic expansion each catch/recast errors. A new private nounset control must survive all three, as must caller/limit failures. |
| `src/shell/runtime.ts:1575` | Current `ParameterExpansionFailure` maps root failure to 127, isolated failure to 1. Reusing it blindly would import unrelated existing behavior. |
| `src/shell/runtime.ts:1659` | Here-document/here-string expansion has additional recasts. Preserve a dedicated nounset control instead of turning it into an ordinary error. |
| `src/shell/runtime.ts:1310`, `:1445` | Root unit and isolated command boundaries already convert private exit flow to shell status. Keep host failures distinct from this conversion. |
| `src/shell/runtime.ts:2034`, `:2754`, `:2784` | Functions/source operate on current state; nested invoke clones state. Existing frame/positional/input cleanup must run during fatal unwinding. |
| `src/shell/runtime.ts:3441` | Command substitution clones state, marks isolation and clears only errexit for bash profile. Do not clear nounset or rewrite errexit. |
| `src/shell/parser.ts:493`, `:500` | Braced parameters have line data; ordinary `$name` currently does not. Populate the existing optional line field, not a new AST shape. |
| `src/shell/arrays/state.ts:203` | Generic tracked state proxy handles scalar property publication; no nounset-specific array API is needed. |

## Proposed finite option grammar (P1)

Inside `set`, scan each sign-prefixed token left-to-right. `-` enables and `+` disables. Recognize `e`, `u`, and `o` only; repetitions are valid. Thus `set -euo pipefail`, `set -eu -o pipefail`, `set +ue`, and `set +o nounset` become useful without changing the meaning of e or pipefail.

Proposed narrow rule: `o` must be final in its cluster and consume the next complete argument, one of `errexit`, `nounset`, `pipefail`. Do not implement an unverified attached-name spelling such as `-opipefail`; mark it outside the initial grammar. Native qualification must determine whether this restriction excludes otherwise valid GNU forms; retain such a gap explicitly. Flags are applied in encounter order, not staged as an all-or-nothing transaction; invalid-tail partial mutation is a proposed rule pending reference/native qualification.

Preserve `--` (including clearing positionals with no following args), lone `-` (no args leaves positionals; trailing args replace them), first nonoption and `positionalSetVersion` updates. The existing lack of x/v means lone `-` cannot claim those Bash effects. Keep no-argument `set`, `set -o/+o` listing, unknown flags, `-E`, `-x`, `local -` option restoration, `shopt -o nounset`, interpreter startup `-u`, SHELLOPTS/BASHOPTS import/display and interactive modes explicitly outside this unit. Do not output a partial table pretending to be the full Bash option inventory.

`$-` should report the actually supported active e/u flags in stable order, without fabricated default Bash letters. The native comparison must qualify this virtual option-inventory difference; do not normalize arbitrary flag text to pass.

## Presence-sensitive expansion (P2)

GNU manual rules and open details are indexed in `REFERENCES.md`. This algorithm is a proposal, not an executed proof:

1. Obtain presence separately from the value. Empty string is present. Positional parameters use index bounds/presence, not truthiness; `$0`, `$?`, `$#`, `$-` remain defined. `@` and `*` are exempt from the ordinary missing-value rule.
2. For `-`, `+`, `=`, `?` forms, apply existing colon/non-colon presence tests first. Expand only the selected word. Missing values legally handled by default/alternative/assignment forms must not fail before that decision. A missing value inside the selected word still can fail. Assignment keeps existing readonly/special-parameter checks and array-zero ownership.
3. On an actual unguarded value read, if nounset is enabled and the relevant parameter/element is absent, create a dedicated private nounset failure with parameter spelling and available source line. Do not throw from environment enumeration, option lookup, completion, variable existence tests, or write-only targets.
4. For supported array element syntax, distinguish absent binding, present empty binding, sparse missing element and present empty element. Bare array name reads element zero. Member expansions `[@]`/`[*]` remain exempt; do not collapse quoted `@` into one empty argument. Scalar-as-array element zero retains current behavior. Higher absent elements are missing reads.
5. Length, substring, trim and replacement are value-consuming forms, not presence guards. Scalar/element reads should use the check. **Unset/empty array member-length `${#a[@]}` and `${#a[*]}` are a reference/native decision gate, not guessed to share the ordinary member exception.** Existing unsupported array operators remain unsupported; no negative/arithmetic indices, associative arrays, namerefs or declaration attributes are added.

Explicit `${x?word}`/`${x:?word}` already work independently of nounset. Do not silently fix their existing root-127 mapping in this unit. Native comparisons must preserve that separate mismatch if found. Guarded assignment to missing positionals/special parameters retains its existing refusal rather than manufacturing a variable.

## Arithmetic and LET (P3 — qualification required)

The general arithmetic manual says null/unset names evaluate as zero, but that paragraph does not resolve nounset's override. A source/native-qualified GNU5.3 determination is required before claiming the following proposed rule as compatibility: missing **read** under nounset fails, empty present value remains zero, plain assignment target creates a variable, compound assignment/increment reads first, short-circuited branches are not inspected, recursive variable expressions test each actual read. Expansion of `$missing` before arithmetic is independently subject to parameter rules.

The existing proxy and evaluator allow this without replacing the arithmetic engine. Preserve the new private control through LET/`(( ))`/`$(( ))` and substring arithmetic catch sites, while retaining current error handling for unrelated malformed arithmetic. Do not introduce an eager pre-scan of all identifier tokens. Array arithmetic remains unsupported; signed 64-bit behavior, recursion/cap limits, existing readonly and LET encounter order remain unchanged. Exact fatal scope and diagnostic name for recursive expressions are open native binding questions, not a promised Bash result.

## Termination, diagnostics and cleanup (P4)

Propose a private nounset expansion-failure class, distinguishable without matching message/code strings. After one diagnostic, convert it to existing private exit flow with **proposed status 1**; GNU's cited manual establishes failure/exit but not this exact number or byte format. Ratify/qualify status before coding. Do not reuse root-127 `ParameterExpansionFailure`, return a normal status that allows the next statement, or expose a new public exception class.

Use current active stderr and script-name/line context, proposed form `name: line N: parameter: unbound variable\n`. Plain parameter parts should receive existing line metadata; multiline/function/source/substitution mappings must be tested. No invented host executable path, native basename, line number, or identity string. Exact GNU prefixes are a separately captured oracle dimension, not blanket-normalized. Existing fallback line 1 is observable when a synthetic invocation has no source span.

Fatal nounset is independent of errexit suppression: a value read in the current noninteractive shell should terminate that scope, even within an `if`/`||`/negated-list context. Functions, braces, source and eval share it and must unwind frames. Subshells, pipeline children and command substitutions terminate their own scope; existing parent status/pipefail/errexit rules then decide parent continuation. For substitutions, distinguish assignment-only command status from an outer successful printf; don't force every substitution error to abort the parent. Nested host invoke retains its existing isolated status boundary and shared budgets; no new global option propagation contract.

Private control must remain identifiable through ExecutionFailure, arithmetic and redirect recasts. Existing invocation/owned-output/input/array-owner cleanup barriers must finish before public settlement; no extra reads, releases or resource acquisition just to diagnose. Raw caller cancellation wins by the existing boundary's provenance, not reason equality. An escaping ShellLimitError or sink/host rejection must not become nounset text/status1. Preserve actual thrown values, including null/undefined. Cleanup failures remain subordinate to an escaping execution failure under the current contract; nounset's eventual nonzero result alone is not an escaping host rejection. A diagnostic-write error must not be swallowed by the generic diagnostic catch at runtime:1572–1573 for this new path. It must go through the existing root failure/cleanup selection. Do not rewrite unrelated diagnostic catches opportunistically.

A reported nounset result does not imply arbitrary opaque input preemption, full first-read compatibility, or successful cleanup of unenrolled host resources.

## Minimal future write set and sequencing

1. `src/shell/runtime.ts`: optional state bit; private set-argument scanner; value-read gate; dedicated control and local catch preservation; existing array/scalar/positional, arithmetic proxy, `$-`, scope boundaries.
2. `src/shell/parser.ts`: populate the **existing** optional parameter line field for unbraced forms, only if exact source-line tests require it.
3. New `tests/compatibility/bash-strict-mode-author-20260829/**` after separate GO; narrow documentation only.

No display change, public types/barrels/package/default count, contracts, shell.ts or arithmetic.ts change is currently necessary. If implementation reveals a need outside these two production paths, report it first. Existing errexit/pipefail selection and unit1 redirect lowering are not rewrite targets. Unit2 source composition must name c83 plus the independently accepted unit1 overlay if/when root approves that base, never live HEAD.

## Decisions requested before implementation

| Decision | Concrete recommendation / unresolved qualification |
|---|---|
| P1 option surface | e/u clusters, terminal o + next exact supported name; preserve positional behavior and existing unsupported listing/status profile; qualify invalid-tail order and omitted/attached o syntax before claiming GNU parity. |
| P2 parameter domain | Check evaluated unguarded reads, not generic lookup; preserve lazy guards and @/* member exceptions. Obtain explicit GNU5.3 result for unset/empty member lengths and existing unsupported array-operator rows. |
| P3 arithmetic | Ratify read-sensitive missing-variable policy only after Sagan primary-source or Faraday qualified-native evidence; no all-identifiers precheck, no generic zero substitution under-u by assumption. |
| P4 boundary | Propose status1, one active-stderr diagnostic, private fatal flow limited to current shell scope, root caller/escaping host+limit errors and cleanup contract preserved. Exact diagnostics/native status remain unmeasured. |
| P5 scope restraint | Keep fresh public exec/new interpreter nounset-off, inherit clone/current-shell scopes, no startup-u/listing/local-/SHELLOPTS work in this unit. No claims for [[ ]], declare/typeset/mapfile/strict integer extensions. |

## Future finite validation, not performed

`CASES.json` freezes **50 identities: 44 literal program probes + 6 host-boundary protocols**. Every expected runtime result is null and every execution state UNRUN. Individual manual/proposal/unknown classification prevents guessed goldens. U27/U28 are specifically unresolved member-length rows. This is not an execution grant or success denominator.

Future oracle admission needs root authorization, pinned actual GNU5.3 binary/version/hash and dependency/fence proof supplied by the separate native lane. Use explicit argv `--noprofile --norc -c program bash-surface`, finite empty-based environment with owned HOME/PATH/cwd, fixed locale, no startup env, host/private reads or network. Only literal file fixtures declared per identity may be created in that lane's owned root; no native invocation is prepared against this repository. Capture exact status/stdout/stderr/file effects and process cleanup. Only a predeclared owned-root pathname token and chosen argv0 can be compared structurally; preserve raw bytes, status and source lines and expose all other differences. No diagnostic removal, field sorting, signal-to-status normalization, or unsupported-row deletion.

The six host protocols are not native equivalence tests. Future author source/build/installed/moved, binding/type/loaded-control checks require their own finite grant and process/capture preseal. At minimum include a mutation disabling the check, an eager-default mutation, lost-private-control mutation, swallowed-diagnostic-sink mutation, and missing cleanup await; no such mutations were executed here.
