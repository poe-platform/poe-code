# Sealed C-profile diagnostic candidate

August 27, 2026. Delegated implementation leaf; no redelegation.
**Public integration HOLD.** No full expr completion, universal parity, GNU/Linux,
superiority, global-gate or elapsed72-hour claim.

## Candidate and scope

- Source plus regression commit: `21220b465537bf45ffcfb36740956a69f43bf75e`.
- Pre-edit baseline evidence seal: `1f24ca26`; baseline source:
  `27a7793526830768484885afba5832bf8bb248b5`.
- The source commit changes **only** `src/commands/expr/syntax.ts` and adds
  `tests/commands/expr/diagnostics-regression.test.ts` plus
  `tests/commands/expr/diagnostics/cases.ts`. No other source/config/export/dependency
  edits, no private integration, no native process spawning in product.
- The two new test inputs are byte-identical to their pre-edit baseline hashes.
  Exact source inventories, tree identity, protected-path checks, and evidence
  hashes are in `SEAL.json`. Canonical tests do not capture or rewrite evidence.

This is an archive of the actual source candidate, not a synthetic baseline with
live source overlays. Between baseline27a and candidate21220b46, four inherited
source changes also exist from other owners: `src/commands/du/README.md`,
`src/commands/du/arguments.ts`, `src/commands/du/du.ts`, and
`src/fs/overlay/index.ts`. The fifth changed source path is this leaf's syntax.ts.
The complete delta and hashes are recorded rather than claiming the entire
candidate differs from27a in only one file.

## Exact nine gaps

All entries have exit2, empty stdout, and a terminating LF. The virtual command
label and GNU frozen argv0 are both **expr**.

| Frozen input ID | Literal argv | Correct diagnostic body |
| --- | --- | --- |
| ambiguous-index-keyword | `["index","index","a"]` | `syntax error: missing argument after 'a'` |
| missing-operands | `[]` | `missing operand`, then `Try 'expr --help' for more information.` |
| missing-rhs | `["1","+"]` | `syntax error: missing argument after '+'` |
| missing-close | `["(","1","+","2"]` | `syntax error: expecting ')' after '2'` |
| trailing-token | `["1","2"]` | `syntax error: unexpected argument '2'` |
| skip-still-requires-rhs | `["kept","\|","1","+"]` | `syntax error: missing argument after '+'` |
| skip-still-requires-close | `["0","&","(","1"]` | `syntax error: expecting ')' after '1'` |
| skip-still-requires-keyword-args | `["kept","\|","substr","abc","1"]` | `syntax error: missing argument after '1'` |
| class-parenthesis-not-capture | `["(",":","[(]"]` | `syntax error: expecting ')' instead of '[(]'` |

The first eight are the original frozen gaps; the ninth is the extension gap.
Markdown escapes the pipe separators only; executable exact argv is preserved
as JSON in native receipts and the focused fixtures. The empty-invocation second
line does not receive a second `expr:` prefix.

The old parser omitted previous/current tokens from fixed messages, conflated
empty invocation with operand exhaustion, and collapsed absent and wrong closing
tokens. The fix retains token context at those existing decision points. It does
not change precedence, AST construction, evaluation, short-circuit grammar,
numeric behavior, locale selection, the BRE engine or worker lifecycle.

C-byte quotation escapes quotes, backslashes, control bytes and non-ASCII UTF-8
bytes instead of allowing argument text to inject raw diagnostic lines. New
quotation work is charged, expanded quoted strings are capped by maxStringBytes,
and complete parser diagnostic bytes are checked against maxOutputBytes before
publication. As before, a budget refusal may emit its fixed status3 limit
diagnostic even when the configured output cap is smaller than that diagnostic;
there is no silent truncation or claim of an absolute all-stderr byte cap.

## Baseline versus candidate

Semantic means exact status/stdout and diagnostic presence. Exact diagnostic
means full stderr bytes, and strict means both. This definition does not treat
matching diagnostic presence as matching error category or wording.

| Focused cohort | Cases | Baseline semantic | Baseline exact stderr | Candidate semantic | Candidate exact stderr/strict |
| --- | ---: | ---: | ---: | ---: | ---: |
| Original gaps | 8 | 8 | 0 | 8 | 8 |
| Extension gap | 1 | 1 | 0 | 1 | 1 |
| Additional invalid controls | 46 | 46 | 3 | 46 | 46 |
| Additional valid controls | 9 | 9 | 9 | 9 | 9 |
| Separate quoted correction1 | 1 | 1 | 1 | 1 | 1 |
| Total focused native observations | 65 | 65 | 13 | 65 | 65 |

Thus the **nine targeted gaps remain9/9 semantic and move0/9 to9/9 exact/strict**.
The separately retained quoted correction is1/1, not a redefinition of the
original unquoted extension input. Original95 and extension20 frozen cohorts,
their UTF-8 rows, failures and old evidence remain unchanged; the different
reviewer owns the unchanged-cohort replay after this seal. Do not infer full
original/extension candidate totals from these focused counts.

## Native identity and command labels

Native expected bytes were frozen before source edits, from the existing pinned
official/development GNU9.7 executable on Darwin, LC_ALL=C. Binary SHA256:
`e8a4e2b58a33d2ad6bfa9eb8a4ed5f62775ab9ceac4b9421680c98973fd9109c`.
Release archive/source member, version and Apple binary pins are checked in the
capture driver and retained in `baseline27a/native.json`.

The fresh absolute-argv0 control is precise: GNU's error prefix still reads
`expr:`. Only empty argv and `--` produce an absolute staged pathname in the
**Try-help line**, because that line binds to argv0. Every other focused capture
is identical between these two GNU invocation bindings. The product correctly
uses `expr --help`, not the staged native pathname. The native oracle and old
author helpers were not modified. Apple rows remain separate, not parity targets.

## Validation and remaining failures

`validate.mjs` built each archive with the existing local TypeScript tooling and
ran scoped source/expr-test strict checks with `skipLibCheck:false`. Candidate
source/tests come exclusively from its Git archive, with no live input overlays.
Baseline overlays only the two new tests and records their pre-edit hashes.

- Build: baseline PASS; candidate PASS.
- Scoped strict checking: baseline PASS; candidate PASS.
- New focused tests: baseline16/71 pass,55 fail; candidate**71/71 pass**.
- Unchanged archived legacy expr tests: baseline241/241 pass;
  candidate**239/241 pass,2 fail**. Combined candidate test count310/312 passes.
- Exactly two old failures: `expr invalid []` and `expr invalid ["--"]` in
  `tests/commands/expr/grammar.test.ts`. Their regex assertion requires
  `syntax error`/runtime-error prefixes, rejecting the corrected GNU empty-input
  `missing operand` plus help output. They remain unedited under ownership rules;
  root must explicitly resolve them, not waive or blindly rebaseline assertions.
- Existing native author tests pass unchanged; the absolute-argv0 help difference
  is not exercised by those legacy cohorts and is not invented as a failure.
- Direct error sinks preserve exact undefined/null/false/zero/empty-string/FsError
  rejection identities; cancellation and late rejection are observed. Tests
  cover awaited writes, no stdin acquisition and zero skipped BRE requests.
- Existing worker controls report138 abort-reason workers and20 lifecycle workers,
  all inactive before safety cleanup. Synchronous child commands settled; both
  owned stage directories were removed in finally and cleanup receipts retained.

Post-run archive input inventories detect changed/deleted/**appended** entries
outside emitted `dist` and linked `node_modules`. Protected historical-path
checks in SEAL cover their original tracked membership, not newly appended files
in other owners' broader directories. No protected frozen evidence was rewritten.

This is archived **source-loader** runtime validation with an isolated ESM and
declaration build, not a moved installed-package/public-consumer qualification.
No root global gates were run. Native reference executables are test oracles only.

## Limits and next review

Non-C diagnostic localization/Unicode presentation is not implemented or claimed;
the new deterministic quoting is C-byte quoting. Existing locale behavior remains
untouched. BRE/nullable and other independent design gaps remain with their owners.

The separately recorded `1 / 0 extra` control still differs: native interleaved
evaluation reports division by zero before trailing syntax, while this AST-first
parser diagnoses the trailing argument first. That underlying redesign is outside
this narrow authorization. It is recorded as a diagnostic mismatch, not a pass.

The reviewer should archive source commit21220b46 and replay the unchanged frozen
original/extension/correction cohorts, keeping Apple separate and argv0 binding
explicit. Public/default integration remains HOLD until its separate authorization.
