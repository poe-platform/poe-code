# #571: admit jq string prefix work

## Current correction and approval

The initial freeze recorded below is historical and superseded. Do not apply
its `owned.patch` or treat its scoped results as a successful full gate.
Root's original full npm test exited 1: **19,051 pass, 3 fail, 63 skip**.
The failures were the resource-file seal and the two split-helper cases below.
The original log `/tmp/kamilio-565-571-npm-test.log` remains untouched, SHA-256
`0ccfd74a19a32cd6239cb1a95a3be1100c52394b7b0d9e953f7de13be18b1d71`.

Current approved production scope is `limits.ts`, `values.ts`, and `split.ts`.
The nine resource string-work tests/imports were relocated, without changing
their bodies, to the new unsealed `string-work.test.ts`. Removing only our
resource additions restores its exact approved 6,029-byte preimage. Semantics
tests retain the phase-specific slice controls; the existing seal explicitly
retires semantics from current-file comparisons. No seal or historical fixture
was modified or rehashed. Root/#565 owns literal inventory registration; the
new path is observed in `scripts/integration-inputs.test.mjs` at line 401.

### Approved split-local optimization

`splitString` uses `floor((maxValueBytes - 2) / 6)` to prove operands fit without
full measurement: a JSON string uses at most six bytes per UTF-16 code unit plus
two quotes. This covers control escapes, quotes/backslashes, UTF-8 multibyte
characters, surrogate pairs, and lone surrogates. Each proven operand still
charges one structural step. Operands outside the conservative proof region use
the original exact, UTF-16-weighted `Budget.value()` path.

This was explicitly approved as avoiding unnecessary full validation, not as a
global budget calibration: no caps/settings changed and no generic Budget fast
path was added. Matching/preprocessing steps, output fragment validation, final
array validation, type checks, and cancellation remain. At `maxValueBytes: 1`,
even an empty operand takes exact validation and fails; at 2, empty operands
fit and the empty result consumes all four existing structural steps.

Error precedence intentionally changes for proven-fit operands: collection
exhaustion can precede a work error formerly incurred by scanning/serializing
the complete input. For fallback operands, weighted admission still precedes
measurement and can report `maxSteps` before `maxValueBytes`.

Measured with the sealed fixtures' original budgets:

- Repeated prefixes: before optimization, 100,026 steps were needed and the
  90,000 cap failed while attempting 90,010. After optimization, exact output
  lengths 10,000 and 4 consume **70,020** steps, within the unchanged 90,000 cap.
- Collection expansion: before optimization, initial input validation attempted
  100,002 steps against the 1,000 cap. After optimization, the unchanged
  collection assertion rejects at **14** steps with `maxCollectionSize`.

### Correction TDD and freeze

All earlier logs/manifests are preserved. New evidence directories under
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/issue-571` are `relocation` and `split-fit`.
The relocation first passed nine tests and the original seal assertion.
The two original split assertions were reproduced unchanged in
`relocation/split-red.log`; diagnostic accounting is in
`relocation/split-accounting.log` and is not a budget allowance.

Nine new unsealed split-proof regressions were added before production changed.
Identical test hashes in `split-fit/red-input.sha256` and
`split-fit/green-input.sha256` bind the RED/GREEN pair; only `split.ts` differs.
They cover all escape/surrogate categories, conservative proof boundaries,
exact fallback, retained structural charges, maxValueBytes 1/2, weighted
fallback admission, fragment/final-array validation, and false/null pre-abort
and in-scan cancellation.

| Log under `split-fit` | Result | SHA-256 |
| --- | --- | --- |
| `red.log` | Before split change: 3 pass, 6 fail | `5f5daa1121c5fa7d91f5f253d6745273dd9424c754bc918b3658b180dafa2f48` |
| `green.log` | Same nine regressions: 9 pass | `5db1b325ec06ea5c4bcc4c59285804f64eba5e280c6ba8b130ce6fd05436b81f` |
| `sealed-helper-green.log` | Two original assertions: 2 pass | `8775304ab61fb7a2ecfdf899a3d5465e57be6a3409bbe2aebd4f75e3dd06bdd5` |
| `focused.log` | Six explicit test files: 293 pass | `3cd8a3733560949cc0ce5dee6d8ce59a770077a59410b1a4d210d05d260972b5` |
| `seal.log` | Original seal test: 1 pass | `6a7f0edea7e4e6313c2b54b04dd9dcd52a4173498a967ce42385786d42d2a16e` |
| `types.log` | Six exact TS roots, no emit: exit 0 | `3d0616083b7cfe91ecb40d6a269203ca24558fb8090833ee6c4f081e2652cea4` |
| `accounting.log` | Original fixture budgets: 70,020 / 14 steps | `dcaa2d55191e4477255cf11def534342bf02d60b2162174350e2304234d37c77` |

All correction GREEN runs have zero failures/skips/cancellations/TODOs. The
original seal still checks 140 live comparisons, 136 unchanged comparisons,
four approved spelling migrations, and 23 historical snapshots.

Test commands use Node 22.22.0, private TMPDIR, disabled tsx cache, unset
NO_COLOR, cleared Git-local child variables, and `--test-concurrency=1`.
From `packages/safe-bash`, the final six explicit files are:
`tests/commands/structured/{string-work,resources,semantics}.test.ts` and
`tests/commands/structured-stress/split-increment/{command,helper,interop}.test.ts`.
These brace lists describe six literal command arguments, not broad discovery.
The separate seal command filters the exact test name
`frozen historical evidence and retained non-native canonical seals remain intact`
in `tests/commands/structured-stress/jq-42-review-fixes/evidence.test.ts`.
RED/GREEN filters `^split fit proof` in the new test file. Scoped typecheck uses
the earlier documented flags, TypeScript 5.9.3 and package-local Node types
22.20.1, with three production files and three structured test files as roots.

Final protected resource SHA-256:
`c61d9f482fc8c76a432d962a134c7834e4fb381a9a501e94b92dc27f79012061`.
Unchanged sealed split helper SHA-256:
`6f800fe74ec0459c7dd883c960df7158056829a17e58bc819cdc3b1903847146`.
Final split source SHA-256:
`5c8b5d20dea60e77d47d7d2261b4d676178fc188a380335c02794c6639da6f99`.
Final unsealed string-work test SHA-256:
`b587e1472e9b55d503de9e8498ed6a84ed44ae07f43cd425951b055be0e2f2a2`.
All final candidate/protected file hashes, including this document, are in
`split-fit/frozen-files.sha256`; `split-fit/evidence.sha256` binds the correction
logs and manifests. No broad gate, build, Git mutation, inventory edit, or
upstream merge was performed here. Root owns integration and delivery. These
scoped passes do not supersede the recorded failed full gate with a passing one.

## Initial implementation record (superseded freeze)

## Scope and policy

Baseline HEAD: `a4266b7013e56c981890b4d92d76f9851ff7908b`.
GitHub issue #571 is authored by `kamilio`. Bounded validation established
quadratic cumulative prefix serialization with linear structural step charging,
not quadratic physical allocation, concatenation copying, CPU time, or RSS.

Charge one additional step per UTF-16 code unit before string concatenation and
scalar-string value validation, including byte measurement and serialization.
Keep existing structural steps, `Budget.step(count)`, and cooperative
`tick()`/`nextYield` behavior. Reuse one concatenated result. Preserve the `add`
left fold and numeric, array, object, null, and mixed-type semantics.

Owned files: structured `limits.ts` and `values.ts`, existing structured
`resources.test.ts` and `semantics.test.ts`, and this plan. No interpreter/slice,
runtime, README, registry, historical test, build, or Git changes are authorized.
This meters admitted work; it does not make reduction linear or promise a CPU,
wall-clock, physical-allocation, or RSS bound. Object keys and other native work
are not recalibrated.

## TDD and validation

1. Add bounded tests for exact UTF-16 plus structural charges, admission before
   native measurement/serialization, escaped/UTF-8 byte limits with sufficient
   work allowance, unchanged other addition types, and unsuppressible hidden add.
2. Record targeted RED against unchanged production, then implement only the two
   admitted string-operation paths and record targeted GREEN.
3. Exercise false/null pre-abort and cooperative cancellation within reduction.
   Preserve phase-specific slice scan assertions: weighted input admission can
   yield before scanning, so abort only after actual slice scanning begins and
   account separately for earlier checkpoints.
4. Run owned test files before any broader maintained structured suite. Use
   Node 22, private TMPDIR, disabled tsx cache, unset NO_COLOR, and cleared
   repository-local Git variables in test children. Typecheck exact files with
   package-local Node 22 types and no emit, not a build or full gate.
5. Freeze exact logs, hashes, and owned diff boundaries for root integration.

## Compatibility adjustments and priorities

Only two existing tests changed behavior: the false/null slice command
cancellation controls now count one earlier input-admission checkpoint and one
in-scan checkpoint separately. They abort only after scanning has started and
retain the original strict `0 < scans < 1100` assertion and zero-write assertion.
The initial unchanged controls failed twice after production changed; their
failure log is retained. No generator or slice implementation changed.

The first new non-string-add fixture expected an ordinary object prototype;
the current implementation deliberately returns a null-prototype object. That
new fixture was corrected before the definitive RED run, without changing
production semantics. The preliminary failed run is retained separately.

No existing size-limit expectation, oracle, skip, or functional fixture budget
was changed. New byte-boundary tests explicitly provide sufficient work budget.
When work and size limits are both exhausted, the new pre-admission policy
intentionally reports `maxSteps` before measuring/checking the value size; a
dedicated test records that ordering. Structural/depth checks remain ahead of
scalar-string work admission as before.

## Frozen evidence: September 4, 2026

Private evidence directory:
`/var/tmp/poe-code-kamilio-561-562.dFKZCV/issue-571`.

Every execution requested escalation. Test/type children used Node `22.22.0`,
the supplied private TMPDIR, `TSX_DISABLE_CACHE=1`, unset `NO_COLOR`, and cleared
variables enumerated by `git rev-parse --local-env-vars`. No build, full gate,
lint route, screenshot, or Git mutation was run by this worker. Root's concurrent
#566 commit advanced HEAD to `efb14bdb0adaed0ba9f8fd269fdf6ff4691150a9` during
this work; it did not change the owned string-work sources.

| Log | Result | SHA-256 |
| --- | --- | --- |
| `red.log` | Preliminary: 4 pass, 9 fail; includes new object-prototype fixture error | `34c18b1ce9c3c3cddcafa9c66566853a42244306e860f3f307da469954599fd1` |
| `red-corrected.log` | Definitive pre-production RED: 5 pass, 8 fail | `c7ebdaf876d1d81f3322e4ea081d7838852b5594391a253a987b838b8ac8b79b` |
| `green.log` | Identical 13 tests after production patch: 13 pass | `14b263896cfd580351944215347720535473a1200892b42f8cd9d4c92a4b1251` |
| `slice-phase-red.log` | Existing first-checkpoint controls: 0 pass, 2 fail | `a2556b370c4b2e7edd8591fd882942ba06c1de3627fea3c9e6a1bc46f78861b3` |
| `phase-green.log` | Expanded focused string/phase controls: 18 pass | `b8b3fd83dd9fec3edf961f33cffd33bd7e07f559caaeb10a01a8e25b13dd9365` |
| `owned-tests.log` | Complete resources/semantics files: 130 pass | `439f5d371981b530c52c6cf57df8b6def615d54f1631aed41e47deac92cd2402` |
| `structured-tests.log` | Five exact maintained structured files: 187 pass | `01cf018e6b02b0667646cdbd84e3ae47092ab573e230a086751b8adf792d63ef` |
| `types.log` | Exact four TS roots, no emit: exit 0 | `3d0616083b7cfe91ecb40d6a269203ca24558fb8090833ee6c4f081e2652cea4` |

The definitive RED/GREEN test-file hashes are identical in
`red-corrected-input.sha256` and `green-input.sha256`; only the two production
files differ. Every GREEN suite above has zero failures, skips, cancellations,
or TODOs. These are scoped results, not root integration/release clearance.

### Exact test selections

All tests use `node --import tsx --test --test-concurrency=1` from repository root.
Paths below are relative to `packages/safe-bash/tests/commands/structured/`:

- RED/GREEN: `--test-name-pattern='^string work'`, `resources.test.ts` and
  `semantics.test.ts`.
- Slice RED: `--test-name-pattern='^slice optional command'`, `semantics.test.ts`.
- Phase GREEN: `--test-name-pattern='^string work|^slice optional command'`,
  `resources.test.ts` and `semantics.test.ts`.
- Owned files: `resources.test.ts` and `semantics.test.ts`, without a name filter.
- Structured files, only after owned tests/types were stable:
  `byte-ownership.test.ts`, `cli.test.ts`, `resources.test.ts`,
  `semantics.test.ts`, and `streaming.test.ts`, without a name filter.

No-emit typecheck used TypeScript `5.9.3`, package-local `@types/node` `22.20.1`,
and exactly the four owned TS files as roots. Flags:
`--noEmit --target ES2023 --lib ES2023 --module NodeNext --moduleResolution NodeNext
--strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes
--verbatimModuleSyntax --forceConsistentCasingInFileNames --skipLibCheck
--types node --typeRoots packages/safe-bash/node_modules/@types`.
Scoped `git diff --check` also passed; no lint success is claimed.

### Owned diff and source hashes

| Owned file | Added / removed lines | Final SHA-256 |
| --- | --- | --- |
| `packages/safe-bash/src/commands/structured/limits.ts` | +1 / -1 | `680b88e658e3152c6c460f9589e1a6b43a61b4e50f7daf588249188e4174bc47` |
| `packages/safe-bash/src/commands/structured/values.ts` | +5 / -1 | `0eb46c3d0c496e6cc252a23ea5d3a4fe2b7975f25cc23d91bfc1815ca433d6f2` |
| `packages/safe-bash/tests/commands/structured/resources.test.ts` | +107 / -1 | `8b6b3c0e2ac423cc84df2a35cf387ebe9ef8ad5fbfd359c8a12a4875284a2de2` |
| `packages/safe-bash/tests/commands/structured/semantics.test.ts` | +85 / -3 | `3d0d1bdaf25b3ef0334d505ce938f47f7ca6f8225a1e0f59754556a66d8d8a54` |

The fifth owned file is this new plan. Its final hash is recorded externally in
`frozen-files.sha256`, avoiding a self-referential document hash. That manifest
also records the four TS files and the unchanged interpreter, whose SHA-256 is
`9e36334d2db0720ad885e5b92db85a84057316f199378f6024b096321f16b874`.
`owned.patch` contains only the five owned files; `evidence.sha256` authenticates
the logs, run-input manifests, frozen-file manifest, and patch. Source/tests are
frozen for root. Root owns full gates, commits, integration, and delivery.
