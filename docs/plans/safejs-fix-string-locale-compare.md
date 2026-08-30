# String localeCompare author plan

## Scope

Implement the newly authorized `String#localeCompare` feature in
`packages/safejs/src/interp/methods/string.ts`, with a dedicated package unit test.
Base main: `e6b70989225781249f2cf395b927186894fad7c2`, cloned and pulled first.
The string-method preimage is SHA-256
`c9424ef6ca0161241527ddb02490a5505c229d0596fe3fdb602a7a2faae0cdd3`
(14,268 bytes). No shared globals/intrinsics file is planned, so Float32Array
work can proceed independently. Any publication overlap requires exact preimage
review; do not blindly overwrite another author's changes.

No README, SKILL, master-ledger, original-checkout, publisher, or original audit
archive changes. No commits, pushes, nested delegation, live skill sync, LLMs,
or executable QA plans. Tests use inline data and no filesystem writes.

## TDD and review procedure

1. Compare the current string dispatch and sandbox conversion contract with
   ECMA-402 String.prototype.localeCompare. Preserve native collation rather
   than replacing the original comparator with code-point sorting.
2. Add native-first failing tests for public source and intrinsic member paths,
   locale/options handling, ordinary invalid inputs, numeric result boundaries,
   exceptions, and finite budget controls. Preserve the RED output.
3. Implement only the package string-method change and rerun unchanged tests.
   Native objects must not become guest values, and errors must not be swallowed.
4. Run relevant string/package tests, fresh standard build, configured types,
   owned test types, scoped lint/format, and strict whitespace checks. Record
   failures without changing unrelated assertions or timeouts.
5. Seal exact patch, preimages, postimages, command results and hashes for a
   different independent validator. Author success is not independent approval.

## Approved original recipe handoff

The read-only copied-input manifest is
`/Users/kjopek/Workspace/poe-code-safejs-o15-o16-final-runtime/out/safejs-remediation/o15-o16-runprep-20260829/final-adjudication-20260829/manifest.json`,
SHA-256 `7a3b37f2904aa4c43513142d6200ba7c90ce8da21b6c7aa126d10cba35c22973`.
Its O15 seeds 123 and 42 use the unchanged public recipes and native oracles:
54 RNG draws, final clock 1006, and ten anchor checks each. Preserve the shared
LCG/time/UUID stream and original 12,000 ms / 256 MiB / 16 MiB caps. The source
must retain `localeCompare`. Noether separately validates these complete recipes;
unit comparison coverage is not a substitute for that full workflow gate.

The manifest's historical feature-scope-open label is preserved evidence, not
the current authorization: the user has now authorized this feature. O16's
deadline observations remain separate and do not authorize a performance fix.

## Delivered implementation

The only production delta is the string-method file. It registers
`localeCompare(compareString, locales?, options?)` in both dispatch paths.
Comparison operands are copied through the existing sandbox-to-host converter,
then string-coerced and checked against `Budget.stringLength`. Source closures
are not wrapped or invoked for comparison coercion. Locale data is copied and
canonicalized with the host `Intl.getCanonicalLocales` implementation.

Only `usage`, `localeMatcher`, `collation`, `numeric`, `caseFirst`, `sensitivity`,
and `ignorePunctuation` are projected from options. Boolean options use ordinary
truthiness before the native call; unrelated fields are ignored. Read option
properties must be data properties. Non-boolean option data uses the existing
copy boundary, which rejects unwrapped sandbox closures. The native string
method receives the comparison string, canonical locale strings, and projected
options, not the original callback-bearing option record. The return is the
native number, not a normalized sign or a substitute sorting algorithm.

This does not add `Intl` or `Intl.Collator` to guest globals, expose a collator,
broaden the generic native-function converter, or implement arbitrary source
`toString`/`valueOf` callbacks. Ordinary comparison data still follows the
existing sandbox copy/prototype model; do not claim universal native object
coercion. No additional public module export, CLI option, or SDK configuration
is required: all entrypoints use the same package interpreter.

Collation uses the host's locale/ICU data, not a newly pinned deterministic
algorithm. Explicit locales do not pin an ICU version. The observed environment
is Node 22.22.2, ICU 78.2, CLDR 48.0, default locale `en-US`; `en`, `de`, `sv`, and
`fr` are available in this environment. Native raw results are compared exactly
in tests, but documentation examples use negative/zero/positive relationships
rather than promising a particular negative or positive integer magnitude.
The standards reference is ECMA-402 2025, String.prototype.localeCompare and
Collator Objects; runtime receipts establish the scoped implementation facts.

## TDD receipts and validation

Evidence lives in `out/safejs-remediation/locale-compare/dist/evidence/`.

| Check                                | Result                                                                                         | Evidence                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------- |
| Initial RED                          | 40 failures; one exposed an author fixture using budget options instead of a `Budget` instance | `red.log`, `initial-red-test.ts` |
| Corrected preimplementation RED      | 40 failures with production still at the exact main preimage                                   | `red-corrected-fixture.log`      |
| First implementation                 | 40 passed                                                                                      | `green-initial.log`              |
| Added native-data forwarding control | 41 passed, 1 failed: a boolean option still forwarded a sandbox callback record                | `red-data-projection.log`        |
| Data projection repair               | 42 passed without weakening the failing assertion                                              | `green-data-projection.log`      |
| Expanded feature tests               | 52 passed, including documentation example and public rejection channel                        | `green-expanded.log`             |
| Relevant broader regression          | 28 files, 3,593 tests passed, no skips or timeout override                                     | `relevant-final.log`             |
| Final forced standard build          | 67 successful tasks, zero cached; root schemas/types/bundle completed                          | `build-sealed.log`               |
| Configured types                     | `npm run lint:types`, exit 0                                                                   | `configured-types-sealed.log`    |
| Owned test types                     | Current root compiler options, dedicated test as root; zero diagnostics                        | `owned-types-sealed.json`        |
| Scoped ESLint                        | Production and new test, exit 0                                                                | `scoped-eslint-sealed.log`       |

The final arity regression first failed (52 passed, one failed) because the new
intrinsic inherited an undefined length. The focused metadata repair sets only
this method to length 1; binding its first argument yields length 0. The final
unchanged feature suite passes all 53 tests (`red-arity.log`, `green-arity.log`).
The final forced build finished at 2026-08-30T03:38:14Z.

The first native bound-method fixture also used a source-text replacement in
its native-only control. Before the corrected RED, it was changed to an explicit
`.bind(left)` in the same source for both engines. No original recipe source was
read or rewritten. The later extraction/call/apply control explicitly checks
the existing bound-intrinsic model against a native bound function; it is not
generic `String.prototype.localeCompare.call` receiver support.

The initial formatter check warned on both owned TypeScript files; formatter
output was applied using `apply_patch`. Setup also preserved an initial zsh
`path` variable collision and guessed inspection paths that did not exist.
These are author inspection/fixture failures, not additional product findings.
No tests, assertions, configuration, deadlines, or version markers outside this
feature were changed to obtain a pass.

Dependencies were installed with `SKIP_SYNC_SKILLS=1`, `HUSKY=0`, and a clone-owned
`.tmp/npm-cache`. Tests and builds used `env -u TERM`. All standard builds forced
all tasks and disabled remote cache/telemetry. Build-generated terminal font
assets are untracked build output, excluded from publication; scoped lint avoids
generated-artifact contamination. No full-repository unit-gate result is claimed.

## Source/public-built/fresh-process controls

`public-api-controls-final.json` retains exact inline commands, inputs, complete
snapshots and outputs. Four unchanged author control sources are first evaluated
natively, then through the public source index and the fresh standard-built
`poe-code/safejs` entrypoint. Each cohort's genuine completed checkpoint is
restored in a separate fresh process with the same source. All sixteen sandbox
observations match the four native values. These are not O15 recipe executions.

The controls are:

1. `README-sign-example`: exact `[true, true, true]`; source SHA-256
   `02bf0a7981be1604fb4e7f5a9c2df31ef511fa75d0a51ccd63a3a1557f44e87f`.
2. `sorting-options-alias`: names `ä, a, item2, item10, z`, preserved options,
   `same: true`, native comparison `-1` in this environment; source SHA-256
   `69b8f984cfc62acbd7bee52efbfd064380556400f157fa36dc610b609a122518`.
3. `caught-locale-error-order`: caught `RangeError`, exact message
   `Incorrect locale information provided`, trace `compare, locale, options`;
   source SHA-256
   `6c0b1fb00d135470e3c44fb7416c25ee43ff29febffdbe4700ae3b2bacb34c0c`.

4. `intrinsic-arity`: exact `[1, 0]`; source SHA-256
   `49ab057d4f29ab8d0c05ddbf34870d1827570dc0c4d32c8ede16b0713280aeeb`.

Final source and public-built uncaught-error controls both reject with the
native `RangeError`; receipts are in `public-error-channels-final.json`.

Children use 12,000 ms parent bounds, 256 MiB old-space caps and 16 MiB output
limits. Guest programs perform no I/O and use no providers. Captures are genuine
public dump/restore data; no marker rewriting or private adapter is used. The
current `jobs-v7` marker is unchanged. These same-host observations do not prove
cross-host collation stability or repair any old failure snapshot. This is a
source candidate, not verification of a newly published npm version.

Minimal proposed README guest source, executed in all four sandbox cohorts:

```js
return [
  "a".localeCompare("b", "en") < 0,
  "same".localeCompare("same", "en") === 0,
  "10".localeCompare("2", "en", { numeric: true }) > 0
];
```

No README or SKILL file is edited by this author. Frozen answers to all six
questions in Curie's draft plan are in candidate metadata
`evidence/README-owner-answers-final.json`; root relays them. The question draft pin is
`23e65f907572e214f08dc404e3734d0dece359b00cfb105f6a4ac8f429b5113d`.

## Independent handoff and limits

Noether's preparation manifest is pinned at
`0617dd0b580bf64943f1e0f24033f094e6236cae57931fd71b3c2f380481e1d0`.
Only its manifest and exact allowlisted boundary-requirement data were read by
this author. Its six O15 recipes, two full native oracles and fourteen proposed
test groups remain independent validation work. Preserve 54 RNG draws, final
clock 1006, ten anchors per seed, shared LCG/time/UUID state and the original
resource caps; do not replace the comparator or normalize a failed oracle.

The candidate has exactly three publication paths: one production file, one
proper package unit test, and this author report/Markdown QA plan. Its manifest
records the existing production preimage, absent new-file preimages, postimages,
patch and evidence hashes. Independent approval and the original full-recipe
verdict remain pending. Float32Array integration belongs to Boyle; no edits to `values.ts`, `interpreter.ts`, or shared globals or unrestricted native-object exposure are introduced
here. Publication on future main still requires exact preimage/order review
and the coordinator's integrated gates.

The superseded pre-arity publication draft and receipts remain historical
evidence. Only `publication-final/` is publishable. The final metadata pins
current source, standard-built output, all six README-owner answers, and the
final 53-test / 3,593-test gates. This is an author handoff, not self-approval.
