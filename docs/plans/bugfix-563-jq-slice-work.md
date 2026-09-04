# #563: cooperative jq string slice work

## Scope and admission

- Base: `8c81239d9b08bb7654308cce468df6517c58b4e4` (September 4, 2026).
- Reconfirmed unchanged SHA-256 against the read-only investigation for jq
  values, interpreter, limits, parser, input, numbers and split sources.
- Own only `packages/safe-bash/src/commands/structured/values.ts`,
  `packages/safe-bash/src/commands/structured/interpreter.ts`, the existing
  `packages/safe-bash/tests/commands/structured/semantics.test.ts`,
  and this plan. No new canonical file or root registry edit is necessary.
- `sliceValue` has exactly one production caller: the slice arm of
  `Interpreter.run`. The interpreter also serves the existing yq query session;
  preserve its supplied Budget rather than introducing another ledger.
- Preserve the earlier generator-order/laziness fix (`a1cdd4bcd`) and numeric
  endpoint handling (`73ed8538b`). No public exports/settings or caches change.

## Defect and work contract

The current helper constructs all code points for every string slice, including
empty/discarded results. Prior bounded evidence: eight slices of 64 code points
materialize 512 point slots, while `.[range(8):1]|empty` writes nothing. This is
not a timing/RSS claim, a generator-depth bypass, or proof of unbounded execution.

Replace full materialization with native string slicing after finding code-point
boundaries. Validate start then end before handling null, arrays, unsupported
types, or empty intervals. Keep array slicing shallow and unchanged.

String work is one awaited `Budget.tick()` immediately before each code point
read with `codePointAt`; astral pairs count once, combining marks separately.
Negative endpoints require a length-counting pass, charged identically, followed
by a separately charged boundary pass when necessary. No scanned pass is prepaid
or exempt. Existing interpreter/command ticks remain; this is an explicit added
scanner cost, not a reinterpretation of their historical step accounting.

Provably empty same-sign reversed intervals and zero end need no scan. After
negative normalization, reversed intervals also stop immediately. An omitted end
uses the native suffix boundary without scanning that suffix; full `[:]` needs no
boundary scan. This does not eliminate or charge away legitimate native copying,
serialization, or output work. No global cache, slice-byte setting, or generator
cardinality cap is introduced.

## TDD and validation

1. RED with existing-file tests: full string materialization for
   repeated/empty/discarded slices, exact scanned-unit charging, rejection before
   over-budget reads, optional hidden-work exhaustion, deterministic cooperative
   cancellation in positive/count/second passes, and false/null reason identity.
2. GREEN: change only the helper and its awaited interpreter call site; preserve
   start → end → base iteration, duplicate products, and short-circuit consumers.
3. Verify the code-point/array endpoint matrix, shallow copies, lone surrogates,
   validation precedence, numeric bounds, generator semantics, and output caps.
4. Run focused existing jq/structured tests and a scoped no-emit TypeScript check
   with package-local Node 22 types. Broad gates/build/release remain with root.

Every exec uses escalation. Test children use the designated Node/npm and private
TMPDIR pointers, clear Git-local variables, unset NO_COLOR, and disable tsx cache.
No README, registry, stage, commit, push, build or broad gate is authorized.

## Evidence

- Original RED is retained in `563-red.tap`: 21 tests, 10 passed, 11 failed.
  Failures include eight full string materializations per repeated/empty/discarded
  filter, missing scanner charges/rejections, empty-result hidden work, and
  absent cooperative/falsey cancellation in the old helper. Existing semantic
  assertions passed. The repeated negative-range hidden-work control already
  exhausted the old structural budget; that is not claimed as a new RED defect.
- First GREEN: 21/21; then optional-command false/null cancellation coverage and
  six selected adjacent suites passed 346/346. Scoped no-emit types had zero
  diagnostics with package-local Node 22.20.1 types, TypeScript 5.9.3 and Node
  22.22.0. These are source-level results, not runner performance measurements.
- Placement correction before freeze: the first existing value-limit file was
  also a literal member of its historical review manifest. Its original bytes
  were restored using only this task's diff, and the new tests moved unchanged
  into the existing `structured/semantics.test.ts`. No historical seal, evidence,
  registry, or other author's changes were edited. Original RED output remains
  intact under its original test pathname. Final checks use the new placement.
- Root fast-forwarded to `a6092b16a2fdc8da7006614d154831f48de0cb34` during work;
  the owned source/test paths had no committed changes across that fast-forward.
- Final placement: **346/346 tests passed**, no failures, cancellations, skips or
  TODOs. Executed from `packages/safe-bash` using `node --import tsx --test
  --test-concurrency=1` and exactly these existing test files:
  - `tests/commands/structured/semantics.test.ts`
  - `tests/commands/structured-stress/jq-grammar-review-fixes/limits.test.ts`
  - `tests/commands/structured-stress/regressions.test.ts`
  - `tests/commands/structured-stress/safety.test.ts`
  - `tests/commands/structured-stress/split-increment/helper.test.ts`
  - `tests/commands/structured-stress/split-increment/command.test.ts`
- Final scoped no-emit TypeScript check: **zero diagnostics**, with only values,
  interpreter and the final semantics test as roots (217 transitive source/type
  files). Resolved Node types explicitly to
  `packages/safe-bash/node_modules/@types/node/index.d.ts` version 22.20.1;
  Node 22.22.0 and TypeScript 5.9.3. Compiler options derive from the package
  tsconfig, with noEmit and package-local typeRoots; no broad include discovery.
- `git diff --check` passed for the owned TypeScript patch.
- Final deterministic regression observations: eight attempts on 64 code points
  perform zero full-string Array.from materializations. End-one and discarded
  end-one cases scan one point total; the all-empty end-zero case scans none.
  Negative-bound cases charge both passes. At maxSteps 4/6, exactly 4/6 reads
  occur before rejection. Direct scan cancellation fires at the existing 1024th
  budget checkpoint before a 1024th point read; optional command cancellation
  also preserves false/null without stdout or diagnostics. The endpoint matrix
  checks 225 string plus 225 array intervals, alongside shallow-copy, surrogate,
  validation-precedence, generator, output-prefix and laziness assertions.

### Retained evidence

Private directory: `/var/tmp/poe-code-kamilio-561-562.dFKZCV`.

| Artifact | SHA-256 |
| --- | --- |
| `563-red.tap` | `c9384e896e89493792236c99209351a8ae63134e97e320e5963c6e8fdbc4fbe5` |
| `563-final-green.tap` | `46dc97d16fddc03e6aaeae6f781a88a082b36a8ca7c6a77817e46c413360e1ab` |
| `563-final-types.txt` | `e8c37db5d98682bb60d900342a97f8deae16487bcffb195f2c7243469df0fedc` |

Intermediate focused/adjacent GREEN and initial scoped type outputs are retained
separately. Original RED remains tied to its original test placement and source
candidate, not rewritten as a final-placement run.

### Frozen TypeScript files

| Path under `packages/safe-bash` | SHA-256 |
| --- | --- |
| `src/commands/structured/values.ts` | `16311b0150457f6802ed41180f40cc2c656516ba6ba81af9d1279bbf40753654` |
| `src/commands/structured/interpreter.ts` | `9e36334d2db0720ad885e5b92db85a84057316f199378f6024b096321f16b874` |
| `tests/commands/structured/semantics.test.ts` | `ab27a42862e58520369a2d4be3fa8e5da77d22869325b63683209a1983f41a1d` |

Restored historical value-limit test SHA-256:
`e3cbea29f8661193eba400c608c8ffa2012f1b42225e6a3544559891b9b7e513`, matching
both its original committed bytes and its untouched review manifest.

## Limits and handoff

The added accounting may exhaust maxSteps for scans that previously went
uncharged. Negative-bound attempts can still scan the input repeatedly; their
work now participates in the existing cooperative budget. Native slicing,
serialization, array copies and actual output remain legitimate work, not
eliminated work or a hard wall-clock/heap guarantee. This is not a new native-jq
oracle qualification; selected existing frozen expectations are reused.

Only the two source files, the existing semantics test, and this plan are frozen
for root review. No new canonical test, README or registry modification. No
build, broad lint/test gate, stage, commit, push or release action was performed.
The shared yq consumer, full package/export checks, lint and release remain for
root's subsequent gates. The independent SafeJS #564 leaf is untouched.
