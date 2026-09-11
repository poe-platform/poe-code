# Issue 690: bounded associative arrays

Implement the issue's explicit minimum: `declare -A NAME`, string-key element
assignment and expansion, key/value enumeration, element counts, and member
unset. Reuse the existing array ledger, saved-local bindings, copy-on-write,
raw shell values, and parser/runtime budgets. No native execution or new
runtime dependency is involved.

## Supported profile

String subscripts retain literal numeric spelling (`01`, `1`, and `1+1` are
distinct), quotes, spaces, bracket characters, variable expansion, and command
substitution. They expand once without field splitting or globbing. Key identity
uses exact bytes; malformed UTF-8 keys never alias their display projections.
Prototype-looking names are ordinary data.

`declare -A` inside a function creates a local binding and restores its outer
binding afterward. Redeclaration preserves contents. Scalar conversion retains
its value at string key `0`; bare assignment updates that key. Conversion from
an existing indexed array is refused without mutation. Other declare modes and
nonempty associative compound assignments remain explicitly unsupported. Empty
`m=()` clears contents and preserves the declared kind. Existing indexed
compound behavior remains unchanged.

`${!m[@]}` and `${m[@]}` enumerate paired keys and values in deterministic
insertion order, without claiming GNU's implementation-specific hash order.
Quoted star/at subscripts select literal keys; member expansion markers retain
their normal quoting and IFS behavior. Associative unset of star/at removes that
literal key, unlike indexed whole-member unset. Accepted key enumeration on
indexed arrays returns indices; a set scalar has key `0`.

Empty assignment keys and readonly associative writes terminate with status 1.
Empty lookup keys diagnose and yield an empty value while subsequent commands
continue. Mapfile refuses associative destinations before pulling input.
Raw scalar conversion, member values, copy-on-write, and expanded unset argv
preserve their owned bytes.

## Implementation and ownership

- Parser subscripts use the existing Lexer for quote-aware closing brackets.
  Parsed key Words retain the invocation's parse budget and nesting depth.
  Deferred unset parsing also uses that budget; expansion reuses existing work,
  field, byte, command, loop, and cancellation checks.
- IndexedBinding adds an associative mode with private numeric slots, admitted
  byte identities, and owned key tokens. Slot numbers never become associative
  keys. Map entry metadata and identity representations are charged before
  allocation; long identity construction checkpoints cooperatively.
- Keys and values share OwnedText lifetimes. Copying promotes shared token
  admissions to the common binding parent before retaining them, preventing
  source-child cleanup from releasing accounting for still-live copied tokens.
  Final token release frees the admission. Failed copies clean up temporary
  entries without draining the source's ownership.
- Distinct key bytes count against aggregate array payload limits; entry and
  metadata budgets also remain unchanged. Temporary lookup buffers release
  their retained-memory admissions after identity construction.

## TDD and review evidence

Initial 8/8 RED: `/tmp/poe-690-red.log`.

The independent GNU Bash 5.2.37 corpora are
`/tmp/poe-690-assoc-oracle.json` and `/tmp/poe-690-assoc-edge-oracle.json`.
Root public source qualification passes 47 checks in
`/tmp/poe-690-public-final.log`, including native semantics, byte identity,
budgets, live cancellation with original reasons, no subsequent effects, and
recovery. Unsupported compound/declare oracle cases are not counted as support.

Further concrete REDs and corrections:

- `/tmp/poe-690-ownership-red.log`: copied keys and raw values lost their charged
  admissions when the source binding closed; common-parent promotion fixes it.
- `/tmp/poe-690-errors-raw-unset-red.log`: empty-key status/lookup behavior,
  readonly associative writes, and raw-key unset; all four controls pass after
  their corrections.
- `/tmp/poe-690-scalar-raw-red.log`: raw scalar conversion lost FF; owned-value
  conversion fixes it.
- `/tmp/poe-690-compound-refusal-red.log`: unsupported nonempty compound syntax
  must refuse rather than publish numbered slots without associative keys.
- `/tmp/poe-690-key-enumeration-red.log`: accepted indexed/scalar key enumeration
  must return keys rather than values.
- `/tmp/poe-690-indexed-adjacent-red.log`: old preflight fixtures used `01`, which
  is now a valid type-dependent associative key. Missing closing brackets replace
  those two fixtures, retaining inactive-branch and zero-side-effect preflight
  guarantees. Direct indexed syntax restrictions remain tested separately.

Independent review approved key/value ownership promotion, shared parse budgets,
quote-aware scanning, and restoration semantics.

## Final maintained checks

From `packages/safe-bash`:

```sh
node scripts/test-reporting.mjs --import tsx tests/shell/associative-arrays.test.ts tests/shell/indexed-arrays-author-20260828/foundation.test.ts tests/shell/indexed-arrays-author-20260828/syntax.test.ts tests/shell/indexed-arrays-author-20260828/s06-v2/regression.test.ts tests/shell/mapfile.test.ts tests/shell/prefix-names.test.ts tests/shell/parameter-transforms.test.ts tests/shell/value-state.test.ts tests/shell/byte-values.test.ts
node ../../node_modules/typescript/bin/tsc --noEmit --strict --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck --target ES2023 --module NodeNext --moduleResolution NodeNext --types node tests/shell/associative-arrays.test.ts
node scripts/test-reporting.mjs scripts/integration-inputs.test.mjs
```

Evidence: `/tmp/poe-690-final-tests.log`, `/tmp/poe-690-final-types.log`, and
`/tmp/poe-690-admission.log`. Root coordinates the normal build, installed
multi-runtime consumer, screenshot, final lint, atomic delivery, and releases.

Final integration qualification completed:

- 363 focused/adjacent tests, 100 admission tests, and strict TypeScript pass.
- Normal `npm run build` passes (`/tmp/poe-690-build.log`).
- Final public source acceptance passes 50 checks
  (`/tmp/poe-690-public-complete.log`): 44 native cases, four budget controls,
  and two live cancellation/recovery controls. GNU status, output bytes and
  input consumption match; product diagnostic labels are explicitly pinned.
  Final native fixtures also cover raw scalar conversion, indexed/scalar key
  enumeration, and empty compound clearing.
- Installed candidate `/private/tmp/poe-690-public-kuebr24e` passes 313 checks
  (50 new plus 263 retained) on Node, Bun, browser, and actual workerd.
  All three strict public type checks and dependency graphs (48/47) pass.
  Root visually inspected `screenshots/node-demo.mjs.png`.
- Final `npm run lint` passes in 378.45 seconds: all 10,522 configured files,
  zero errors/warnings, 25 receipts, plus type and workflow checks
  (`/tmp/poe-690-lint.log`).

A three-second live CPU sample (`/tmp/poe-690-lint.sample.txt`) identified
filesystem directory enumeration as a major cost. Independent review found no
redundant fresh observations that could be removed while preserving temporal
validation, so no speculative lint changes were made. Timing is uncontrolled
and is not claimed as a causal performance comparison.

These are local qualification results; remote-main delivery and actual registry
publication are tracked separately.
