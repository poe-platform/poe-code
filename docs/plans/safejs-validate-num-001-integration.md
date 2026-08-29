# Independent merged NUM-001 validation

## Scoped decision

**READY for the exact eleven-file NUM-001 integration candidate on the pinned base only.**
This is not full-suite, full-publisher, actual-main, or all-JavaScript compatibility certification.
The pending IP002 parser companion and all retained limitations below remain unresolved.

- Date: August 29, 2026. Independent delegated worker; parent orchestrates.
- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-function-arity-integrated`.
- Base: `7fec2826bac2933483c2579ff47d2264f8e1f422`, main.
- Frozen author manifest: `out/safejs-remediation/num-001-integration/manifest.json`.
- Author manifest SHA-256: `06bca1e0a6eb34e5fc41cde3e64930823b7f3cd9b35beddb88abe561b4977ba1`.
- Eleven publishables, seven existing-base preimages, four new paths, zero merge conflicts.
- No source/test/assertion changes by this validator. This new report and its evidence are separate from the eleven publishables; historical plans and old captures remain unchanged.

## Integrity and original access

Read ancestor/root AGENTS and worked directly as the assigned validator. Independently checked
all eleven live and captured postimages, all seven `git show BASE:path` preimages, all 35
manifest-listed author evidence artifacts, and all 32 protected prior-fix paths. Protected
paths equal both the author-recorded hashes and the pinned base, before and after gates.
The approved prior manifest is read only from its captured copy in this workspace; original
arity, CTX, and LANG clones are neither read nor written.

The seven current preimages also equal the approved old preimage hashes. Thus no intervening
change in these files needed a manual resolution. All incoming postimages are unchanged except
the already-authorized append-only author-plan integration section; its 17,832-byte historical
prefix independently matches its recorded hash. The tracked diff remains exactly seven files.
Generated terminal-pilot font assets were already untracked and are not candidate material.
No Git mutation, branch, commit, push, README edit, or publisher change occurs.

Before original payload access, `inventory-verification.json` installed all **38 exact excluded
paths** plus the **entire security directory** guard. Five explicit nonexcluded paths only:
root REPORT, numerics REPORT, and numeric originals 08, 10, and 11. Guarded reads enforce both
path containment and realpath identity. No recursive audit/family search, excluded payload
read/hash/execution, original write, or security investigation occurs. Exact allowlist,
exclusions, metadata digest, byte counts, and read hashes are in `bootstrap.json`.
All three original source byte hashes equal the AST-extracted approved test template literals.
No payload is taken from another clone.

## Seven current preimages and IP002

| Path                                                  | Bytes | SHA-256                                                            |
| ----------------------------------------------------- | ----: | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/async.ts`                 | 13135 | `7702c005879c8abe584120cf8e801ece0302a149092132a7963b192d2ee27c26` |
| `packages/safejs/src/interp/methods/function.test.ts` |  5470 | `45792d9adc49524326c71eea569e3a8a4860a6e5bebb98e5d8538aec8b9eb48e` |
| `packages/safejs/src/interp/methods/function.ts`      |  2736 | `1534bcb7a9ee11089044d2633776019e941f119270e73cee62a0f38fda2673f6` |
| `packages/safejs/src/interp/values.ts`                | 25906 | `487d392c295977bdd144713382e5ab142d85a3dfac27a8fe9cfea8c669dbbf75` |
| `packages/safejs/src/parse/bindings.ts`               |  3412 | `ebc6b0da68470dd371da6197a34a5e9dcafc08c087b03feb7606f6868d8460e8` |
| `packages/safejs/src/snapshot/restore.test.ts`        | 48978 | `6524d83e2ee496fecb4a3c57a0185534cba5ca4a15016167216a1ce53f60e9b3` |
| `packages/safejs/src/snapshot/restore.ts`             | 26908 | `5bd4247f7fc44348b1f1ef8e91693927013eb36a702b0f6f04f8388d152c1322` |

**None of these seven paths overlaps `packages/safejs/src/parse/parser.ts`.**
`parse/bindings.ts` is a separate file, not the queued IP002 parser patch.
The pinned parser remains byte-identical at SHA-256
`8e6c8b4e5d2d5484dcf5149f5a55da7d6427e0ed62444fe079ec64ee1f1ff114`.

The unchanged IP002 companion source
`return ({ async ["load"](value) {} }).load.length;` returns **1** natively but
still rejects on both pinned base and merged candidate with
`ParseError: Expected '}' at line 1, column 17.` Both native-comparison commands
remain exit 1; full differences are retained in `ip002-pending.json` and command
records. No parser workaround, rewritten source, added exclusion, or claim of resolution.
After the separately approved parser companion lands, rerun this exact source and integrated
arity gates. No file overlap does not eliminate the need for semantic revalidation.

## Arity and integration review

The five production files add source metadata without replacing the interpreter or any prior-fix
implementation. `getFunctionLength` finds the first **top-level** AssignmentPattern or
RestElement. Nested defaults/rest within a destructuring pattern still represent one required
parameter. Parameter expressions are not executed to derive length.

Ordinary/async functions, arrows, named expressions, generator functions, and supported object
method forms attach optional immutable, non-enumerable metadata. Bound positional arguments
reduce arity; a bound receiver does not. Rebinding clamps at zero and retains existing receiver,
argument, constructor, and arrow semantics. Explicit function properties, including explicitly
undefined properties, keep precedence. Host/builtin wrapper lengths and general reflection are
not added to the contract.

Valid snapshot restoration recalculates length from source AST parameters without changing the
snapshot schema. Low-level restored-source/rebinding tests remain selected. Current active
checkpoint tests independently retain ordinary, default/rest, destructuring, async-returned,
and generator source arity together with ARRAY own metadata and aliases. Binding occurs after
resume; this does not promise a new serialized-bound-closure representation.

Two active checkpoints each contain one pending await. Full native/current/restored values
match for both. The first preserves source functions on array-owned metadata and default
initializer side effects; the second preserves async-returned and generator functions, invokes
newly bound functions after replay, and retains the custom array label. Full snapshots and
outputs are in `active-checkpoint-results.json`. Only in-memory wait promises are used.

Six supported unfiltered native/current compositions additionally cover ARRAY own function
properties and bound callbacks, call evaluation order, live Map/Set iterator insertion,
Object aliases carrying source functions, contextual `from`, STR03 replacement callbacks,
MC numeric aliases, and nested-default binding. These are independent of the suite selector.
One additional `forEach`-mutation composition remains failed identically on base and candidate:
the established collection callback mutation guard rejects with `reentry`. It is not the live
iterator cursor contract. Its original assertion and full failed output are retained; the
separately added supported live-iterator control does not replace or weaken it. Neither NUM-001
nor this validation authorizes new callback mutation behavior.

## Genuine current-base RED and selected GREEN

The baseline executes current tests with an in-memory Vite overlay of the **five exact current-base
production preimages**. Each preimage digest and each loaded override is verified. Live production
files stay untouched; the incoming test assertions stay exactly the same.

- Focused current-base RED: **49 failed, 47 passed, 26 excluded; 122 total, four files**.
- Focused merged GREEN: **96 passed, zero failed, the same 26 excluded**.
- Selected combined broader gate: **1,598 passed, zero failed, 82 excluded; 1,680 total, 39 files**.
- This broader run is **not a full suite**. Excluded counts are not passing counts.

Upstream control results within the selected broader run:

| Control group             | Passed | Excluded |
| ------------------------- | -----: | -------: |
| ARRAY own metadata        |     26 |        0 |
| ARRAY/call order          |     15 |        0 |
| COLL cursors              |    136 |        0 |
| OBJ aliases               |     40 |        0 |
| MC003                     |     79 |        0 |
| TREE / HI / STR03 / MC001 |    369 |        0 |

The current selector strings are identical to the frozen author strings. Independent JSON
results match every expected excluded file/name, not just the count. All function-arity,
prior NUM-001 validator, and function-method assertions are selected. All new valid-restore
arity cases and all six upstream groups are selected. No arity or integration regression was
converted to an exclusion. The 26 focused exclusions concern existing corrupt/prototype/depth
snapshot boundaries, not source-arity assertions. The broader 82 comprise the prior 70 plus
12 existing inherited/prototype/member-boundary cases; all names are disclosed in the appendix.
No probe is introduced or executed to broaden this scope. Those excluded semantics remain
uncertified, not silently passed. Ordinary intersecting callback/metadata/restore paths are
covered by selected tests and the unfiltered compositions/checkpoints.

Exact selector strings, all selected file/name/status rows relevant to arity, every exclusion,
and control counts are in `suite-scope-audit.json`. Focused and broader command records retain
full Vitest JSON, including failure/skip metadata and multiline parameterized names.

## All three unchanged original algorithms

Native data-URL module imports execute the **complete unchanged archive bytes**, twice each,
before current TypeScript execution. Then the pinned base, merged source, and completed replay
are compared with those complete native values. No dist imports, textual source replacement,
algorithm simplification, surrogate workload, field projection, or floating-point tolerance.
Only transport prototypes are normalized; undefined, negative zero, and nonfinite values have
explicit evidence tags where applicable.

- Original bisector SHA-256: `48a385b2cc8b7a55a18daae961d849b51eafe9ed476206fb13366f7b7d859b2f`.
- Explicit-mode control SHA-256: `8a1801ee2d1539642887239ec5a3523be7af2c1bdadfdad7c466e2d2f52c17c7`.
- Original reduction SHA-256: `c48df811c81dd2def901ea69e485ae9359ed5c39a91a539114bacd7f22db618b`.

Merged descending rows are exactly **`[[5,7,5],[3,5,3],[1,2,1]]`**. Full sorted IDs,
ascending rows, captured-scale results, restricted range, both arity fields, and complete
explicit-mode/reduction outputs also match. The pinned base retains zero descending rows and
undefined arities; its explicit-mode control passes. Across two repeats, the base has eight
mismatches among twelve fresh/replay comparisons; the candidate has **zero among twelve**.
There are six native anchors, six merged fresh results, and six completed replays.

Full output files: `original-native-anchors.json`, `original-current-base-red.json`,
`original-merged-current-replay.json`; exact raw sources are in `originals/`.
Command records preserve complete stdout/stderr and exact ad hoc driver text.

## Commands and configured gates

All commands run in the isolated workspace with
`env -u TERM SKIP_SYNC_SKILLS=1 POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error`.
The exact argument arrays, current-base overlay code, selectors, timestamps, exit statuses,
and full outputs are retained in `commands/` and indexed in `command-index.json`.

- `npm run build`: **67/67 successful tasks**, 65 cached; runs before all typechecks.
- `node_modules/.bin/vitest run <four focused files> --testNamePattern <unchanged focused selector> --reporter=json`: **96 pass / 26 excluded**.
- `node_modules/.bin/vitest run <unchanged combined file set> --testNamePattern <unchanged combined selector> --reporter=json`: **1,598 pass / 82 excluded**, selected broader only.
- `node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: source types pass.
- Configured TypeScript program with package compiler options and both new test roots
  (`function-arity.test.ts`, `num-001-validation.test.ts`): zero diagnostics.
- `npm run lint:types`: configured root types pass.
- `npm run lint:eslint`: configured repository ESLint passes with no added ignore patterns.
- `npm run lint:packages`: all 17 rules pass.
- Explicit ESLint on all nine candidate TypeScript files: pass.
- `node_modules/.bin/prettier --check <all eleven publishables>`: pass; this report is separately checked.
- `git diff --check`: pass. No full repository-format or full test suite is claimed.

The validator also ran an **additional expanded typecheck of all four candidate test files**.
It remains exit 1 with **38 existing diagnostics**: nine in function.test.ts and 29 in
snapshot/restore.test.ts. Exact base and merged checks have identical diagnostic codes,
messages, source lines, and multiplicities after accounting for inserted-line offsets; zero
new diagnostics. Both failed runs and complete diagnostics are retained in
`expanded-typecheck-limitations.json`. This does not turn that expanded gate green or erase
its failures; the required source and two-new-test configured gates pass independently.

Retained driver mistakes are separately identified, never counted as product failures or green
checks: the initial original baseline driver asserted five imports although completed replay
loaded only four production modules; the rerun explicitly loaded all five and retained the
strict assertion. Two first attempts to compare expanded type diagnostics had an escaped-newline
syntax error before TypeScript ran; corrected drivers use `ts.sys.newLine` and preserve every
diagnostic. All prior output remains intact.

## Freeze and publication boundary

The frozen candidate captures **exactly eleven postimages and seven current-base preimages**,
with four new-path absences verified at the pinned base. The validator adds no twelfth candidate
file; this independent report is separately captured as evidence. All original author hashes,
assertions, historical report bytes, and 35 evidence hashes are rechecked before capture.

Worker output: `out/safejs-remediation/num-001-integration-validation/`.
Exact candidate bytes and hashes: `manifest.json`, with digest in `manifest.sha256`.
Full command/output/source/limitation evidence: `evidence-manifest.json` and `readiness.json`.
Captured files and directories are read-only plus macOS immutable; live sources and author
capture permissions are not altered. No staging or publishing is performed.

This snapshot does **not** certify actual-main preimages, the pending IP002 companion,
excluded tests, expanded legacy-test type correctness, real-service E2E, host/builtin length,
general function reflection, unsupported source forms, or full publisher gates. Publisher must
reconcile actual-main preimages and rerun integrated gates after queued changes; independent
validation must be renewed for materially changed candidate bytes. Old arity/CTX/LANG snapshots
are not substituted for this current-base evidence.

## Appendix: unchanged exclusions

The following is the complete independently observed **82-name** broader exclusion list.
The **26** names also excluded in focused runs are marked. These are disclosures, not pass claims.

### `packages/safejs/src/restore.test.ts`

- restore rejects malformed dump envelopes: missing version
- restore rejects malformed dump envelopes: unknown version
- restore rejects malformed dump envelopes: missing hash
- restore rejects malformed dump envelopes: unsafe clock cursor
- restore rejects malformed dump envelopes: unsupported value
- restore rejects malformed dump envelopes: negative clock count
- restore rejects malformed dump envelopes: non-finite loop cursor
- restore rejects malformed dump envelopes: negative collection cursor
- restore rejects malformed dump envelopes: dangling heap reference
- restore rejects malformed dump envelopes: invalid heap tag
- restore rejects malformed dump envelopes: malformed heap array

### `packages/safejs/src/run.test.ts`

- run rejects unbounded recursion with the default call-depth guard
- run supports edge-case import local names without leaking inherited namespace members
- run supports empty Promise iterables and enforces budgets through run()

### `packages/safejs/src/interp/generator.test.ts`

- sync generators halts infinite generators through the node visit budget

### `packages/safejs/src/interp/interpreter.test.ts`

- interpret loop resume breakpoints still halts an infinite loop under a small node budget
- interpret new expressions does not expose prototypes and rejects instanceof for user constructors
- interpret spreads only an object's own enumerable keys
- interpret charges arrayLength budget for object spread properties
- interpret charges arrayLength budget while spreading array literals from iterables
- interpret charges arrayLength budget for spread call arguments
- interpret defines dangerous array properties without changing the array prototype
- interpret throws a sandbox error when template literal concatenation exceeds the allocation budget
- interpret honors stringLength budget for tagged template quasis
- interpret throws a sandbox error when binary string concatenation exceeds the allocation budget
- interpret throws a sandbox error when the step budget is exceeded
- interpret throws a sandbox error when a string literal exceeds the allocation budget
- interpret reports a clear budget cause for self-recursive arrows that exceed maxCallDepth
- interpret does not expose host prototypes through typeof [1].entries
- interpret does not expose host prototypes through typeof 1..valueOf
- interpret reads own custom properties but not inherited properties from host arrays
- interpret re-enters callback closures under the same budget for intercepted array methods
- interpret does not treat inherited interpreter fields on host rejections as internal errors
- interpret caps million-element for...of iteration through the step budget
- interpret caps infinite for loops through the step budget
- interpret caps infinite while loops through the step budget
- interpret caps infinite do/while loops through the step budget
- interpret charges the step budget during do/while iterations
- interpret preserves an own **proto** key in catch object rest bindings
- interpret does not charge budget for a skipped if branch

### `packages/safejs/src/interp/promise-replay.test.ts`

- PromiseReplay does not replay a fatal budget rejection as a promise settlement

### `packages/safejs/src/interp/values.test.ts`

- sandbox values rejects deeply nested host ingress and final-result export with typed depth errors
- sandbox values preserves null-prototype objects in both directions
- sandbox values preserves own **proto** keys as data in both directions
- sandbox values rejects throwing enumerable accessors instead of invoking host getters

### `packages/safejs/src/snapshot/replay-data.test.ts`

- replay result data does not invoke accessors while recording results
- replay result data rejects own accessors without invoking them while decoding
- replay result data rejects inherited accessors without invoking them while decoding

### `packages/safejs/src/snapshot/replay-inputs.test.ts`

- initial replay inputs rejects absent capabilities without calling replacements or following inherited properties

### `packages/safejs/src/snapshot/restore.test.ts`

- snapshot restore rejects corrupt arguments metadata: extensibility **[also focused]**
- snapshot restore rejects corrupt arguments metadata: length order **[also focused]**
- snapshot restore rejects corrupt arguments metadata: callee replacement **[also focused]**
- snapshot restore rejects corrupt arguments metadata: missing value **[also focused]**
- snapshot restore rejects corrupt arguments metadata: iterator flags **[also focused]**
- snapshot restore rejects corrupt arguments metadata: accessor **[also focused]**
- snapshot restore bounds deeply nested data retained through arguments length **[also focused]**
- snapshot restore rejects mutated snapshots: missing source hash **[also focused]**
- snapshot restore rejects mutated snapshots: missing scope id **[also focused]**
- snapshot restore rejects mutated snapshots: duplicate scope id **[also focused]**
- snapshot restore rejects mutated snapshots: dangling parent **[also focused]**
- snapshot restore rejects mutated snapshots: cyclic parents **[also focused]**
- snapshot restore rejects mutated snapshots: dangling capture **[also focused]**
- snapshot restore rejects mutated snapshots: dangling node **[also focused]**
- snapshot restore rejects mutated snapshots: unsafe id **[also focused]**
- snapshot restore rejects mutated snapshots: invalid promise **[also focused]**
- snapshot restore rejects mutated snapshots: fulfilled promise without value **[also focused]**
- snapshot restore rejects mutated snapshots: rejected promise with value **[also focused]**
- snapshot restore rejects mutated snapshots: mismatched host call tag **[also focused]**
- snapshot restore rejects mutated snapshots: invalid generator **[also focused]**
- snapshot restore rejects mutated snapshots: invalid generator completion **[also focused]**
- snapshot restore rejects mutated snapshots: malformed map entry **[also focused]**
- snapshot restore rejects mutated snapshots: negative regex cursor **[also focused]**
- snapshot restore rejects mutated snapshots: non-finite number payload **[also focused]**
- snapshot restore preserves prototype-shaped keys and validates before wrapping host modules **[also focused]**
- snapshot restore does not index AST nodes from inherited type and nodeId fields
- snapshot restore preserves null-prototype sandbox objects during restoration **[also focused]**
- snapshot restore ignores inherited serialized value kind tags during restoration

### `packages/safejs/src/snapshot/serialize.test.ts`

- serialize serializes the boundary byte-identically and rejects deeply nested arrays and objects
- serialize serializes own **proto** object properties as snapshot data
- serialize does not classify inherited runtime markers as closures or promises
- serialize serializes undefined, non-finite numbers, null-prototype objects, and string ids

### `packages/safejs/src/interp/methods/array.test.ts`

- array methods exposes intercepted array members

## Coordination addendum: OBJ002 overlap

NUM has **seven existing-file preimages, not seven production preimages**: five production files and two existing tests. The exact paths are:

- `packages/safejs/src/interp/async.ts` — production.
- `packages/safejs/src/interp/methods/function.test.ts` — test.
- `packages/safejs/src/interp/methods/function.ts` — production.
- `packages/safejs/src/interp/values.ts` — production.
- `packages/safejs/src/parse/bindings.ts` — production.
- `packages/safejs/src/snapshot/restore.test.ts` — test.
- `packages/safejs/src/snapshot/restore.ts` — production.

Against the six OBJ002 paths supplied by the coordinator, the **only overlap is
`packages/safejs/src/snapshot/restore.ts`**. Its NUM pinned preimage SHA-256 is
`5bd4247f7fc44348b1f1ef8e91693927013eb36a702b0f6f04f8388d152c1322`; its NUM validated postimage SHA-256 is
`e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a`.

No overlap with `snapshot/arrays.ts`, `snapshot/serialize.ts`,
`snapshot/dump-format.ts`, `snapshot/validation.ts`, or the actual root-level
`packages/safejs/src/graph-depth.ts`. `snapshot/arrays.ts` is absent in this pinned
NUM workspace; no assumption is made about the new OBJ002 file's contents. The OBJ002
candidate/clone was not read, and no source or duplicate edit was made.

Publication must be serialized: whichever patch lands second must reconcile the shared
`snapshot/restore.ts` against actual main rather than overwrite the earlier patch,
and must undergo fresh integrated validation. Filename overlap alone does not establish
an intrinsic NUM-before-OBJ or OBJ-before-NUM prerequisite; the coordinator must use
OBJ002's own reviewed manifest and semantics for that choice. This pinned snapshot does
not certify the merged NUM+OBJ002 result. IP002 remains a separate queued parser
companion with no direct NUM preimage overlap. Exact coordination data is in
`coordination-obj002-overlap.json`.
