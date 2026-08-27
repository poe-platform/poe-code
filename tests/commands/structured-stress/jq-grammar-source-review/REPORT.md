# Independent jq grammar source review — August 27, 2026 UTC

**NOT ACCEPTED. Two real native-semantic gaps remain.** This is a different
independent source verifier, not the source author or preparation/proposal
reviewer. Only this new subtree is owned. No source, canonical assertion,
previous evidence, package, root, shell, filesystem, network or archive edit;
no delegation and no canonical proposal approval.

## Handoff and identity

- Source commit: `b9187c0f601c278b334f5a391d552c38c433444c`.
- Required structured SHA-256:
  `120a10c34d96b26f584c6e4349ef9098c0537d76952078e70e9ce6ab5c3f0176`.
  Checked using the old, unchanged `sourceSnapshot()` **before first product
  import**, then enforced throughout. All structured files also match the
  source commit byte-for-byte. No current hash was substituted for the handoff.
- Preparation files, manifest and native35 match `d5b8fff`; the manifest's
  235 historical files remain unchanged. `review.json` also verifies the
  accepted legacy baseline against independent commit `bb1ceabe`.
- Source cohort phase: `2026-08-27T02:10:52.536Z`–`02:10:54.312Z`, product hash
  `a885b9b6b08757ac25ee356f27147ef1d64bc5f97beffb7887009f6113c15f81`.
- Compiled cohort phase: `2026-08-27T02:12:14.545Z`–`02:12:18.282Z`, product hash
  `d846423b0a7063021dafe9b8b08b42399decf72b0ba71a6f90c750d98f1b70cd`.
  Each cohort phase was internally stable; these are **different dirty,
  moving-product snapshots**, not a single clean committed-HEAD validation.
- All source files, tooling hashes, Git state and phase boundaries are retained
  in the JSON artifacts. `review.json` records the complete six-file source
  diff, SHA-256 `0a45e1b0bfcbee25c78895364dc1259af32476d4dce1058716dfc4e673d1826e`.
- Author README, REPORT.md/REPORT.json and committed-r3 evidence were read.
  REPORT files appeared after initial inspection; their final read hashes are
  recorded. Author test files match author evidence commit `97bf8010`.

## Exact unchanged cohorts

| Cohort | Vectors | Source executions | Emitted-root executions |
| --- | ---: | ---: | ---: |
| Whole historical main | 256 | **790/790** | **790/790** |
| Original42, included in main | 42 | 84/84 | 84/84 |
| Whole legacy | 94 | **376/376** | **376/376** |
| Independent frozen grammar | 35 | **174/178** | **174/178** |
| Total, excluding duplicate original42 | 385 | **1340/1344** | **1340/1344** |

Main retains historical155, additive81 and reviewer20, original transport
schedules and every direct pipeline-stage assertion. New35 retains all
whole/bytewise/every-selected-cut schedules, endpoint empties, namespace/file
effects and both actual public Shell pipelines. No unsupported builtin is
skipped. `source-cohorts.json` and `compiled-cohorts.json` contain complete
vectors and every status/stdout/stderr hex tuple, stage and effect comparison.
The immutable old main harness is used for source main; compiled main uses the
preparation's API-injected executor with the same vectors/schedules/comparator.

Original legacy baseline remains **45 exact / 49 differences**, comprising
**43 diagnostic-only + 6 status/stdout** differences, or **180/376 exact**.
All43 diagnostic vectors now match in **172/172 executions per entry**, with
the complete rows separately retained in `review.json`. Whole94 is not reduced
to these43, and old42/790 evidence is not replaced by this new result.

### Blocker 1: missing `isfinite/0`

Frozen vector `nonfinite-type-copy-predicates` fails direct/Shell ×
whole/bytewise, **4/4 executions on each entry**:

```text
argv: ["-c","map([type,isnan,isinfinite,isfinite,{copy:.},[.,.]])"]
stdin: [NaN,Infinity,-Infinity,null,"NaN","Infinity",0]\n
native: status 0; complete numeric/predicate/copy array; stderr empty
virtual: status 3; stdout empty; isfinite/0 is not defined compiler diagnostic
```

Exact multiline diagnostic, trailing spaces, expected array and both hex byte
tuples are in `review.json` and both cohort reports. The VFS remains unchanged.
`src/commands/structured/parser.ts:31` and
`src/commands/structured/interpreter.ts:202` implement the neighboring predicates
but omit `isfinite`. This is a requested semantics gap, not a dialect exemption.
The pinned native result treats NaN as finite for this predicate; substituting
JavaScript `Number.isFinite` would not close the vector.

### Blocker 2: aliased-container NaN ordering

Source inspection found `src/commands/structured/values.ts:27` returns comparison
zero for identical container references **before recursive number comparison**.
That equality optimization is not valid for native NaN ordering. One focused
neighbor was frozen twice on the pinned native binary, then replayed unchanged:

```text
argv: ["-c","map([.==.,.<.,.<=.,.>.,.>=.])"]
stdin: [[NaN],{"x":NaN},[[NaN]],{"x":[NaN]},[Infinity],{"x":0}]\n
native first four rows: [true,true,true,false,false]
virtual first four rows: [true,false,true,false,true]
last two finite/infinity controls agree: [true,false,true,false,true]
both statuses: 0; both stderr: empty; namespace unchanged
```

This is **0/4 exact on source and 0/4 on emitted root**, not a harness error or
an unsupported operation. `alias-order-native.json`, `alias-order-source.json`
and `alias-order-compiled.json` preserve the full byte tuples and reproduction.
The same-reference equality result must remain true while the ordering shortcut
is corrected; blindly removing equality identity behavior is not the fix.

## Source inspection and bounded neighbors

- `input.ts`: one incremental byte parser tracks quoted/escaped strings,
  structural stack, token completion, byte positions and initial BOM separately.
  Numeric conversion only occurs for complete unquoted literals; no global
  replacement touches quoted lookalikes. Malformed tokens stop subsequent reads.
- `jq.ts`: JSON sources are joined under one parser, so BOM and partial-token
  state span file boundaries; raw input retains its separate route. Initial BOM
  bytes are excluded from diagnostic columns. Per-file input location metadata
  remains separate from parser byte offsets. Frozen file/error/pipeline effects
  passed, not merely returned text.
- `numbers.ts`, `values.ts`, `interpreter.ts`: parsed Decimal NaN/infinities are
  distinct from rendered null/max-double and arithmetic-produced IEEE numbers.
  Untouched decimal copies retain precision; arithmetic reads the double value
  without mutating a Decimal. Equality recursion is separate from ordering, but
  the ordering alias shortcut above is still incorrect. Finite overflow lexemes
  are not interchangeable with explicit infinities for literal comparison.
- Arithmetic remainder bounds conversion to signed 64-bit range before BigInt
  remainder; NaN and zero checks precede conversion. This inspection and the
  author arithmetic tests are bounded evidence, not all arithmetic parity.
- `parser.ts`: leading-zero/trailing-decimal numeric filters are recognized;
  quoted tokens are scanned first. Native compiler context changed the old
  regex assertions. `split/2` remains explicitly unsupported, not stubbed.
- Cancellation/limits: input and value bytes, collection/depth, evaluation steps,
  output bytes and diagnostics remain bounded. Scanner cooperative checkpoints
  and shared byte I/O retain supplied cancellation; synchronous work and
  uncooperative host operations are not forcibly preempted. These are logical
  limits, not a hard resident-memory/wall-clock bound.

Exactly **four** source-driven additional vectors were used, not broad fuzz:
three initial neighbors (fresh nested copy/equality/order, observable escaped
numeric-string controls, EOF after partial BOM) pass **12/12 per entry**; the
fourth alias-order vector fails **0/4 per entry** as detailed above. Both native
captures of every vector are retained. The original mixed-container vector,
whose duplicate key overwrites an earlier member, was never edited.

Native: `/usr/bin/jq`, `jq-1.7.1-apple`, `--with-oniguruma=builtin`, SHA-256
`1625910a3f99fbd11c3ad58cc16ebc359507e6e19c21e91d8ab7da2116c8429f`.
New native probes use shell:false, isolated argv/stdin, explicit C locale/UTC,
owned cwd, a 2-second watchdog and a 64-KiB output ceiling. No native fixture
files or subprocess invocation in product code were introduced.

## Host I/O: not native parity

The unchanged old failing test is
`jq-42-author-20260827/safety.test.ts:30`: **it instantiates `JqError`, not generic
`Error`**. Its EPIPE branch expects rejection identity; its JqError branch
explicitly expects a resolved status5. That branch now rejects.

Before the handoff, the outer catch rethrew generic Error and EPIPE, converted
JqError to status5, and converted FsError EIO to status2 with stderr. The new
stdout-origin flag rethrows all four without diagnostic fallback. The exact
parent/handoff diff is frozen in `review.json`.

`host-contract.json` independently exercises all four classes with both ordinary
and NaN input: **8/8** preserve exact thrown identity, perform one attempted
stdout write, read one record, close upstream, emit no stderr and leave an empty
VFS. Shared `writeBytes` also preserves each rejection identity. These checks
are host behavior checks, not native byte-comparison credit.

**Assessment:** no generic-Error regression and no failure of the shared
`ByteSink`/`writeBytes` contract (`io.ts:7`, `io.ts:132`). There **is a real
observable compatibility change** for typed JqError/EIO sinks, including an
explicit old JqError test. `CommandHandler` does not specify conversion of
typed sink failures into statuses. Origin-based rejection is consistent with
byte-helper identity and avoids disguising host failures as jq diagnostics,
but the old assertion cannot be called a native-backed stale test. Root must
adjudicate/document the command-level policy before any separate test-only
change. This review does not approve a generic canonical refresh.

## Safety, build and type results

| Gate | Independent result |
| --- | --- |
| Old seven failure boundaries, strict rejection/watchdog ×3 | 7/7 each; no skips/cancellations |
| Old safety16 + new limits9, strict/watchdog ×3 | 24/25 each; same old JqError branch red |
| Old author114 | 113/114; same host assertion |
| Historical binary/additive controls | 238/238 |
| Nearby/boundary controls | 117/117 |
| Entire unchanged relevant structured suite | **1550/1580**, all30 failures retained |
| New author grammar/legacy/scan/limits suite | **2157/2157** |
| One bounded repeat of new author suite | **2157/2157**, product identity still unstable |
| Old independent scoped TypeScript | pass |
| Author scoped TypeScript | pass |
| Global `npm run typecheck` | **fail**, TS2769 in unowned core-sort test |
| Independent in-memory TypeScript build | **pass**, 520 outputs, zero diagnostics |
| Same whole cohorts against emitted public root | **1340/1344**, same isfinite failure |

The broad30 names and full TAP bytes remain in `broad-unchanged.json`. They
correspond to the author's 22 historical +4 acceptance +3 compiler assertion
+1 host-sink groups. This is a result inventory, **not independent approval of
the proposed replacements**. The independent missing-predicate and alias-order
failures are additional and are not hidden inside the canonical assertion count.

TypeScript 5.9.3 / Node v22.22.2 build uses the actual root
`tsconfig.build.json`, changes only outDir, captures all ESM/declarations/maps
in memory, and imports emitted `index.js`. All130 runtime product modules load
from emitted bytes; synchronous hooks reject runtime imports from `src/`.
tsx processes immutable test helpers only. `dist/` is untouched. Emitted file
hashes, loaded module paths and before/after snapshots are recorded. This is
not an npm-pack/install validation.

Global typecheck observed `tests/commands/core-sort/regressions.test.ts:36`
passing `CommandResult | Promise<CommandResult>` to `assert.rejects`; no unowned
fix was attempted. Its result is separate from the author's earlier global pass.
During author2157, `diff-patch/patch.ts` moved; the sole bounded phase repeat
again saw movement (`diff-patch/README.md`). Further unrelated FS, shell and
metadata changes are recorded in `review.json`. Structured source remained
pinned. No further repeat or whole-product identity claim is made.

## Research and evidence limits

Official web research consulted the jq1.7 manual and tagged jq1.7.1 sources:

- `https://jqlang.org/manual/v1.7/`: retained decimal precision versus arithmetic
  double conversion; numeric predicates and rendering are not interchangeable.
- `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_parse.c`:
  literal/string state, byte columns and incremental BOM handling.
- `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv.c`:
  allocated-reference identity in `jv_equal`, distinct from ordering.
- `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_aux.c`:
  `jv_cmp` recursively compares arrays/objects even when they alias.
- `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/jv_print.c`:
  NaN/null, preserved literal text and bounded printed binary infinity.
- `https://raw.githubusercontent.com/jqlang/jq/jq-1.7.1/src/builtin.jq`:
  `isfinite` is numeric type and not-infinite, including the measured NaN case.

These are primary-source reasoning aids, not proof that Apple's binary has
byte-identical upstream source. Exact expected bytes come from pinned frozen
native observations. No full jq/Bash parity, superiority, completed product or
72-hours-work claim follows.

Reviewer setup correction is preserved: the first report audit selected an
earlier legacy checkpoint (41 exact /47 diagnostic /6 acceptance) and failed
its 45/43/6 assertion before writing an artifact. The accepted independent
`bb1ceabe:r2-legacy.json` is now verified and used for classification. The first
cohort reports omitted nonexistent baseline summary fields; `review.json`
supplies the correct accepted baseline. No fixture/output/expected tuple was
changed and no product rerun was needed for this metadata correction.

## Required followup

1. Source owner fixes `isfinite` and recursive aliased-container NaN ordering;
   preserve current byte fixtures and add no public API/dependency/native process.
2. Different independent verification reruns whole790, legacy376, new178,
   frozen alias4 and safety gates on a newly explicit source handoff.
3. Root resolves typed host-sink compatibility separately; proposal reviewer
   handles any separately approved canonical TEST-ONLY changes.
4. Documentation owner reconciles stale strict-JSON/UTF-8/error-stop claims.
   Product owner obtains a coherent global build/typecheck snapshot when useful.

Existing author failures, timeouts, baseline observations and old manifests are
read-only and preserved. This handoff returns with actionable failures rather
than waiting for source or canonical edits.
