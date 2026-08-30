# Frozen RegExp search: independent bounded fix

## Authority and isolation

Author workspace: `/Users/kjopek/Workspace/poe-code-safejs-frozen-search-20260830`.
Fresh shallow main clone, followed by normal `git pull --ff-only --no-stat`:
`5dafe7a59bf21da7365befe60e6b4d8d901e8669` (clean before author edits).
The user reports guard 13.0.4 release verified; actual alias artifact validation
remains pending. This author does not confer release approval.

Only production change authorized: the two existing `lastIndex` assignments in
`packages/safe-js/src/interp/methods/string.ts` search branch become conditional
on `Object.is`. Both unconditional writes are pre-existing, not introduced by
sticky support. Preserve negative zero, required-write errors and execution
abrupt completion; no `finally` restoration. No other production edits, flags,
compile accounting, async owner handling, native matching fallback or dependencies.
All sticky 702 drafts, capsules and plans stay untouched and unexecuted.

## Exact extraction from the original 34 draft observations

Read-only source:
`/Users/kjopek/Workspace/poe-code-safejs-sticky-y-corrective-prep/docs/plans/safejs-sticky-y-corrective-regressions.patch`.

The new `string-search-frozen.test.ts` contains these 13 original source recipes:

| Original group                         | Included parameters             | Cases |
| -------------------------------------- | ------------------------------- | ----: |
| Frozen non-global native outcome       | input `a`, `b`                  |     2 |
| Required-write API rejection           | flags `g`, input `a`, `b`       |     2 |
| Caught completion and frozen +0 cursor | flags empty/`g`, input `a`, `b` |     4 |
| Required initial frozen write          | cursor `-0`, `1`, `NaN`         |     3 |
| Exact negative-zero restoration        | flags empty/`g`                 |     2 |

The original four built observations with empty/`g` flags and `a`/`b` inputs
reuse the first four guest recipes. They remain included as public SDK checks;
public validation also repeats the other nine admitted recipes. Thus 17 of the
original 34 observations are admitted, represented by 13 unique recipes tested
at both source and current built public SDK boundaries against native results.
No original draft file or original oracle is changed.

Excluded, not waived: 14 observations require unsupported `y` or `gy`; three
require raw cursor behavior outside this two-write correction (frozen string
`"0"`, object cursor with frozen false/true). Current `setRegexMember` in
`packages/safe-js/src/interp/methods/regex.ts` coerces assigned cursors with
`Number(value)`. These three raw-cursor observations remain unexecuted here and
must not be represented as passing. No fixture is altered to hide that mismatch.

## Bounded execution sequence

1. Install in this private source clone, normal hooks, only `SKIP_SYNC_SKILLS=1`.
   Isolate HOME, XDG config, npm cache/user/global config and TMPDIR; unset TERM.
   No hook bypass, no shared writable modules. Disk before clone was 1.6 GiB,
   after clone 1.5 GiB. The 436 MB reference is an estimate, not a measurement
   of this install; allow cache/build overhead and stop on setup failure.
2. Run only the new source test root on unchanged main and retain raw RED.
3. Inspect the exact SafeJS dependency build graph before building. Build only
   SafeJS and verified necessary prerequisites, never full-root build/suite.
4. Execute finite native/current built `poe-code/safe-js` comparisons from this
   clone using ordinary Node resolution, no source aliases or transpiler loader.
   Capture baseline RED before any production edit. Preserve complete arrays,
   NaN, negative zero, return-vs-rejection and caught error names.
5. Only after RED, apply the two `Object.is` guards, rerun source and public
   comparisons GREEN, with a package-only rebuild for the changed source.
6. Run relevant current guard, receiver, String and cursor roots; scoped format
   and lint checks. Record failures without changing unrelated production code.
7. Stop immediately and release CPU for actual-alias validation. Independent
   different-agent review precedes publication; publisher owns Git and README.

All execution evidence goes under `out/safejs-remediation/frozen-search/`;
plans stay here. Unit tests write no files and call no LLMs. Finite public SDK
QA is performed by the author from this plan, not installed as a QA script.

## Results

Normal-hook `npm ci` succeeded: Node v22.22.2, npm 10.9.7, 550 packages added.
Measured private node_modules 416 MiB and npm cache 101 MiB; free disk 1.0 GiB.
Install reported one high vulnerability and a glob deprecation; no audit probe,
dependency change or security clearance is made in this bounded correction.

Initial unchanged-main source RED: 6 failed, 7 passed (13 total), raw log
`source-red.log`. Four failures establish frozen non-global search divergence.
Two additional failures are the old draft's host `instanceof TypeError` assertion:
current `exceptions.ts:175` coerces host errors into subset error records and
`exceptions.ts:214` surfaces those records. The existing `run` rejection contract
therefore exposes `name: "TypeError"`, not a host TypeError instance. Only the new
test's API-rejection assertion is adapted to that source-derived contract;
native still must throw TypeError, rejection still must reject with that name,
and original draft/raw RED remain unchanged. Re-run qualified baseline before
production edits. This is not a production error-projection change.

The Turbo dry run unexpectedly enumerated 69 tasks; it was NOT executed.
The exact recursive dependency closure of `@poe-code/safe-js#build` is 23 tasks.
Only those verified tasks were invoked individually in dependency order using
`npm run build --workspace <name>`; no root build or unrelated task fanout.
Full graph and each task's exit status are preserved in `build-graph.json` and
`build-red.log`. Subsequent rebuild is SafeJS only.

Qualified unchanged-main source RED (`source-red-qualified.log`): 4 failed,
9 passed, exit 1. Genuine canonical built SDK RED (`public-red.log`): 4 failed,
9 passed, exit 1. Both identify precisely the two frozen non-global hit/miss
recipes and their caught-completion variants. Production was unchanged for both.

After the two guards, source GREEN (`source-green.log`): 13 passed, exit 0.
SafeJS-only rebuild (`build-green.log`): exit 0. Genuine built SDK GREEN
(`public-green.log`): 13 passed, exit 0. Public resolution is this clone's
`packages/safe-js/dist/index.js`, not a Vitest alias or another workspace.
Each public comparison uses `assert.deepStrictEqual` against native completion;
logs retain full array values, NaN and negative zero via `node:util.inspect`.
Thrown completion is explicitly compared by rejection channel and error name,
not native host prototype, message text or stack equality. No host bindings,
callbacks, LLMs, filesystem operations or snapshot fixtures are introduced.

Relevant regression run: 26 roots, 3,016 passed, zero failed/skipped, exit 0
(`regressions.log`), including the 13 new source tests. Current guard, callback
receiver/stack, ownership, String coercion, locale, cursor, replacement and split
tests are unchanged. No full-root build or suite ran. ESLint for both changed
TypeScript files: exit 0 (`eslint.log`). Expanded scoped test typecheck: exit 0
(`test-types.log`). Production types also passed in both package builds.

Initial formatting check failed for the new test and this plan, not production
(`format-initial.log`); formatting-only corrections follow via apply_patch.
Final formatting and patch checks are recorded in `format-final.log` and
`diff-check.log`. No old sticky GREEN applies to this main. No security
certification, actual npm artifact approval or independent approval is claimed.

CPU-intensive work is finished. No author runtime/build process remains running.
Only light formatting/evidence capture follows; root's actual-alias validation
has priority. Publication still requires a different independent reviewer.

## Commands and repeatable public QA

All commands run from the author workspace with this environment, normal hooks:

```sh
export HOME="$PWD/out/safejs-remediation/frozen-search/install-home"
export XDG_CONFIG_HOME="$PWD/out/safejs-remediation/frozen-search/install-config"
export npm_config_cache="$PWD/out/safejs-remediation/frozen-search/install-cache"
export npm_config_userconfig="$XDG_CONFIG_HOME/npmrc"
export npm_config_globalconfig="$XDG_CONFIG_HOME/global-npmrc"
export TMPDIR=/tmp/poe-code-frozen-search-20260830
unset TERM
SKIP_SYNC_SKILLS=1 npm ci
node_modules/.bin/vitest run packages/safe-js/src/interp/methods/string-search-frozen.test.ts
npm run build --workspace=@poe-code/safe-js
node_modules/.bin/vitest run packages/safe-js/src/interp/budget.compile-guard.test.ts packages/safe-js/src/interp/budget.test.ts packages/safe-js/src/interp/regex/compile-*.test.ts packages/safe-js/src/interp/methods/string*.test.ts packages/safe-js/src/interp/methods/regex-cursor*.test.ts packages/safe-js/src/interp/methods/regex.test.ts packages/safe-js/src/run.string-coercion.test.ts packages/safe-js/src/interp/globals/string-coercion.test.ts packages/safe-js/src/interp/globals/error-string-coercion.test.ts
node_modules/.bin/eslint packages/safe-js/src/interp/methods/string.ts packages/safe-js/src/interp/methods/string-search-frozen.test.ts
node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --resolveJsonModule --types node,vitest/globals packages/safe-js/src/interp/methods/string-search-frozen.test.ts
node_modules/.bin/prettier --check packages/safe-js/src/interp/methods/string.ts packages/safe-js/src/interp/methods/string-search-frozen.test.ts docs/plans/safejs-frozen-regexp-search-20260830.md
git diff --check
```

The initial prerequisite build differs from the later package-only rebuild:
read `build-graph.json`, recursively visit only dependencies of
`@poe-code/safe-js#build`, assert 23 distinct tasks, and invoke each task's
workspace build in postorder, stopping on the first nonzero exit. The complete
verified order and results are in `build-red.log`. Do not execute the 69-task dry
graph or repeat installation/builds without CPU authorization.

For the public QA, run ordinary `node --input-type=module` from this clone and
import `run, Budget` from `poe-code/safe-js`. Record `import.meta.resolve` first.
Use exactly the 13 source recipes listed above: direct and caught empty/`g`
search on `a`/`b`, initial frozen cursors `-0`/`1`/`NaN`, and mutable empty/`g`
negative-zero restoration. Execute `new Function(source)()` for each native
oracle and `await run(source, { budget: new Budget({ maxSteps: 20_000 }) })`
for each built SDK observation. Native throws must be host TypeError; project
both throws to `{ kind: "rejection", name }`, successful returns to
`{ kind: "return", value }`, and preserve unsuccessful interpreter results as
a distinct failure channel. Deep-strict-compare every complete projected
observation; log both sides with unlimited-depth `inspect` and exit nonzero on
any mismatch. The same finite recipe matrix and adapter were used before and
after the fix. SDK adapters are new bounded QA, not historical C06 adapters.

## Reviewer handoff and factual README answer

Owned publication paths are only this plan, `string-search-frozen.test.ts`, and
the two-line change in `methods/string.ts`. Exact preimage/postimages and patch
are sealed under `out/safejs-remediation/frozen-search/candidate-5dafe7a-sealed-20260830/`.
The earlier `candidate-5dafe7a/` checkpoint remains unchanged.
The two new paths have no preimage at base main. No other source, README,
ledger, original checkout, historical capsule or sticky draft is changed.

Factual README answer for the publisher: frozen non-global RegExp search at
positive zero now returns native hit/miss results; required cursor writes still
fail, and mutable negative zero is restored. No new RegExp flags or syntax are
enabled. Raw string/object cursors, sticky activation, Unicode and actual
published-artifact validation are outside this patch. Author results alone do
not authorize release.

## LIGHT seal: exact qualification and remaining gaps

No runtime, install, build, typecheck, formatter or tests run during sealing.
Only this plan changes after the recorded final format check; that earlier
format pass does not certify these added paragraphs. Source and test bytes
remain exactly those captured at CPU release. Stock Git patch application,
byte comparison and receipt hashing are the only sealing validations.

The two source assertions changed before production edits are precisely
`preserves required-write API rejection /a/g on a` and the same test `on b`:

```diff
- await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).rejects.toThrow(TypeError);
+ await expect(run(source, { budget: new Budget({ maxSteps: 20_000 }) })).rejects.toMatchObject({ name: "TypeError" });
```

This is a host-boundary assertion qualification, not an equivalent assertion:
the erroneous assumption that a surfaced sandbox error inherits native
`TypeError.prototype` is removed. Native `.toThrow(TypeError)` is unchanged.
Both guest sources, input strings, freeze placement, 20,000-step cap, and
rejection requirement are unchanged. No return oracle, cursor oracle, fixture,
skip or cap changes. No candidate-dependent expected charge is introduced.

Source-derived justification at exact base: `interpreter.ts:481` calls
`coerceThrownValue`; `exceptions.ts:191` converts native errors with
`createSubsetErrorValue`; `exceptions.ts:281` creates a plain record containing
name, message and stack; `exceptions.ts:224` surfaces that record, not a host
TypeError instance. The initial raw log already shows name `TypeError`, the
read-only-lastIndex message and the sandbox search stack for the rejected
global control. Production error projection is not changed by this patch.
The qualified baseline still fails all four genuine search divergences.
Independent review must assess this boundary qualification; author results
do not establish host error prototype, message or stack equivalence.

Exact stable IDs below follow source-test expansion order. `T` means the
rejection channel with name `TypeError`; it never means a successful return.
All array values are compared whole, including SameValue-sensitive -0/NaN:

- S01: frozen `/a/`, input `a`: return `0`.
- S02: frozen `/a/`, input `b`: return `-1`.
- S03: frozen `/a/g`, input `a`, uncaught: T.
- S04: frozen `/a/g`, input `b`, uncaught: T.
- S05: frozen `/a/`, input `a`, caught: `[["return", 0], +0, true]`.
- S06: frozen `/a/`, input `b`, caught: `[["return", -1], +0, true]`.
- S07: frozen `/a/g`, input `a`, caught: `[["throw", "TypeError"], +0, true]`.
- S08: frozen `/a/g`, input `b`, caught: `[["throw", "TypeError"], +0, true]`.
- S09: frozen `/a/`, initial -0: `[["throw", "TypeError"], -0, true]`.
- S10: frozen `/a/`, initial 1: `[["throw", "TypeError"], 1, true]`.
- S11: frozen `/a/`, initial NaN: `[["throw", "TypeError"], NaN, true]`.
- S12: mutable `/a/`, initial -0: `[0, -0, true]`.
- S13: mutable `/a/g`, initial -0: `[0, -0, true]`.

Original source observations are S01-S13. Original public observations map to
S01, S02, S03, S04, giving exactly 17 retained original observations. The new
public adapter repeats S01-S13, so actual validation is 13 source plus 13 built
cases, not 26 distinct recipes or 26 original observations. Raw initial RED
fails S01-S06 (6/7); qualification changes only S03/S04 to pass. Qualified
source and built RED fail S01/S02/S05/S06 (4/9). Both GREENs pass S01-S13.
The entire original source RED and both public outcome logs are copied byte
for byte, not replaced by this summary. Error-message/stack/prototype equality
is not asserted by the new public adapter; complete projected observations are.

Required initial writes remain observable in S09-S11; required execution writes
and abrupt rejection remain observable in S03/S04/S07/S08. S12/S13 check exact
negative-zero restoration. The production branch still exits immediately on
abrupt execution with no finally restore. These finite controls do not prove
all possible abrupt-error identities or unsupported custom exec behavior.

Remaining compatibility gaps stay in the overall remediation scope:

- Sticky `y`/`gy` activation: exclude 4 source required-write observations,
  4 caught source observations, 2 negative-zero source observations and
  4 original public observations, exactly 14. All remain unexecuted here.
- Raw string cursor preservation: exclude frozen `"0"`, exactly 1. Current
  `regex.ts:42` eagerly applies `Number(value)` rather than retaining the value.
- Raw object cursor identity and coercion ordering: exclude object `valueOf`
  cursor with frozen false/true, exactly 2; retain the original expected event
  and identity oracles for later work. These are not fixed or waived here.

Preserved nonpassing receipts include initial 6/7 RED, qualified 4/9 RED,
public 4/9 RED, and initial formatting failure for this plan and the new test.
Install and bounded builds had no setup failure; the npm high-severity warning
and glob deprecation remain recorded without remediation or security clearance.
The 69-task graph was dry-run only; 23 dependency-closure workspace builds and
one later SafeJS-only rebuild ran successfully. No lockfile/dependency edits,
module sharing, full-root suite or full-root build occurred. The final packet
retains the 13/13 source, 13/13 built and 3,016/26-root results without rerunning
them. Franklin's independent review and actual release validation remain pending.
