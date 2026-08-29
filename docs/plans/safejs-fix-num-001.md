# NUM-001: source function arity

## Scope and isolation

- Work only in `/Users/kjopek/Workspace/poe-code-safejs-function-arity`, on `main`.
- Fresh single-branch main clone and successful `git -c pull.rebase=false pull --ff-only` precede work. Base: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`.
- Original repository and shared remediation workspace remain read-only. No branch creation, stash, reset, commit, push, README changes, additional agents, guest capabilities, or security probes.
- Install pinned dependencies using `SKIP_SYNC_SKILLS=1 npm ci`; build only the shared setup report's three explicit dependency filters (21 tasks).
- Bootstrap the explicit 38 archived paths from `inventory-verification.json` and block the entire security directory before payload reads. Audit metadata is historical; do not refresh excluded hashes.

## Contract and implementation plan

1. Retain the complete original NUM-001 D3 bisector, explicit-mode control, and arity reduction unchanged in regression tests; establish bounded native results before current-source SafeJS execution.
2. Reproduce the nine descending-index errors and absent ordinary/arrow/generator lengths before production edits.
3. Derive source arity from AST formal parameters, stopping at the first top-level default or rest parameter. Destructuring counts once, including nested defaults.
4. Apply metadata to supported ordinary functions, arrows, async functions, generators, object methods, and restored source closures. Preserve call/apply/bind behavior and derive bound arity without exposing unsupported forms or host implementation signatures.
5. Run focused regressions, broad relevant non-adversarial unit coverage, and typechecking; retain exact red/green and full original outputs for a separately assigned validator.

## Audit qualification

NUM-001 is a confirmed native incompatibility causing silent algorithm loss, ranked P1. The existing README promises supported function syntax and call/apply/bind, not an explicit exhaustive `function.length` contract. This patch does not claim general function property mutation/reflection, new syntax, collection fixes, or array metadata fixes. Overall remediation continues; publication and independent validation belong to the coordinator.

## Implementation and coverage

The production patch adds 25 lines across five existing files. The parameter-count helper stops at the first top-level AssignmentPattern or RestElement; it never executes a default initializer. Closure metadata is optional, frozen, and non-enumerable. Source functions and generators receive it at construction; snapshot restore recomputes it from the original AST without a snapshot schema change. Bound source functions subtract captured positional arguments and clamp at zero. Existing explicit closure properties retain lookup precedence, and unannotated host closures keep their previous undefined length rather than leaking a host wrapper signature.

Regression coverage includes 13 parameter lists across ten supported source forms, default-initializer side effects, computed reads, calls with omitted/extra arguments, call/apply receivers, binding/rebinding, bound constructors and arrows, six restored-source forms, and custom-property precedence. No classes, async generators, generator methods, or new function-property mutation/reflection APIs are introduced. The interpreter dispatcher and all bisector algorithm code remain untouched.

## Setup and validation results

- Fresh main clone/pull base: bc85287c08cfa8796af80c76d0dd8dd2ddf7347b; HEAD and branch remain unchanged.
- Pinned install: exit 0, 548 packages added. Existing lock audit reported 10 dependency vulnerabilities; no dependency/lock change or audit fix was attempted.
- Dependency build: 21/21 tasks succeeded using the shared report's explicit filters.
- Focused RED before production edits: exit 1, 24 failed / 73 passed / 97 total, 1.71 seconds. Failures are absent arity, the nine original descending indices, binding metadata, and restored arity; the full explicit-mode control passes.
- Identical focused GREEN after implementation: exit 0, 97/97 passed, 1.73 seconds.
- Broad relevant suite: exit 0, 797/797 tests in 15 files, 4.49 seconds.
- SafeJS TypeScript check: exit 0. Changed-file ESLint: exit 0. Changed-file Prettier check and git diff whitespace check: exit 0 after applying formatting.
- Original current-TS replay: bounded native expectations established first, then all three unchanged originals match their complete native return values exactly. Child exit 0, signal null, stderr empty. No dist import.
- No visual CLI changes; screenshots are not applicable. No full repository/release validation, publication, or independent validator approval is claimed.

Exact focused command (RED and GREEN):

```sh
./node_modules/.bin/vitest run packages/safejs/src/interp/function-arity.test.ts packages/safejs/src/interp/methods/function.test.ts packages/safejs/src/snapshot/restore.test.ts --reporter=verbose
```

Exact broad command:

```sh
./node_modules/.bin/vitest run packages/safejs/src/interp/function-arity.test.ts packages/safejs/src/interp/methods/function.test.ts packages/safejs/src/interp/async.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/values.test.ts packages/safejs/src/interp/promise-replay.test.ts packages/safejs/src/parse/bindings.test.ts packages/safejs/src/parse/generator.test.ts packages/safejs/src/snapshot/restore.test.ts packages/safejs/src/snapshot/serialize.test.ts packages/safejs/src/snapshot/replay-data.test.ts packages/safejs/src/snapshot/replay-inputs.test.ts packages/safejs/src/restore.test.ts packages/safejs/src/run.test.ts --reporter=verbose
./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
```

## Original source anchors

Read-only audit root: /Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27. The NUM-001 report and selected independent review distinguish the strong observed algorithm loss from the weaker implicit metadata contract. Audit provenance pins d3-array bisector/ascending at be0ae0d2b36ab91b833294ad2cfc5d5905acbd0f (ISC; Mike Bostock). The original audit's adaptation keeps all three searches, arity branching, defaults, stable duplicate ordering, captured-scale changes, descending data, and restricted intervals; it specializes the upstream function-identity self-check to the supplied anonymous comparator.

The new regression file embeds the following entire audit examples as template literal values. TypeScript AST extraction after formatting confirms byte-for-byte equality and these SHA-256 values:

| Audit-relative path                      | SHA-256                                                          |
| ---------------------------------------- | ---------------------------------------------------------------- |
| numerics/08-bisector-stable-ordering.ajs | 48a385b2cc8b7a55a18daae961d849b51eafe9ed476206fb13366f7b7d859b2f |
| numerics/10-bisector-explicit-mode.ajs   | 8a1801ee2d1539642887239ec5a3523be7af2c1bdadfdad7c466e2d2f52c17c7 |
| numerics/11-function-arity-reduction.ajs | c48df811c81dd2def901ea69e485ae9359ed5c39a91a539114bacd7f22db618b |

Archive-read accounting: the initial discovery listed path names and queried explicit root REPORT/COMPLETION metadata before installing the persistent guard; it did not read excluded file bytes. Before reading any numerical source payload, the guard loaded the exact 38-path exclusion set from inventory-verification.json and blocked the whole security directory. Subsequent case/report/provenance reads use explicit paths through that guard. No excluded payload was read, displayed, copied, executed, or rehashed. No whole-audit or whole-family content search was used. Initial path-only security listings are not certified as payload reads or payload validation.

## Full original outputs

The following are the complete return values, not selected-field projections. Undefined is preserved explicitly as {"$undefined":true} in RED. Native execution uses node:vm with a 1,000-ms timeout, adapting only the host export wrapper. SafeJS receives the unchanged module source with entryPointArgs: [], maxSteps 500000, maxCallDepth 128, stringLength 16384, arrayLength 512, dataSize 1000000, and a 5,000-ms interpreter deadline. The current-TS host child has a 15,000-ms timeout and 192-MiB old-space cap.

### Native expected (established before SafeJS)

```json
{
  "08-bisector-stable-ordering.ajs": {
    "sortedIds": [5, 1, 3, 2, 6, 0, 4, 7],
    "ascendingResults": [
      {
        "target": -1,
        "left": 0,
        "right": 0,
        "center": 0
      },
      {
        "target": 0,
        "left": 0,
        "right": 1,
        "center": 0
      },
      {
        "target": 1.5,
        "left": 1,
        "right": 3,
        "center": 1
      },
      {
        "target": 1.75,
        "left": 3,
        "right": 3,
        "center": 3
      },
      {
        "target": 2,
        "left": 3,
        "right": 5,
        "center": 3
      },
      {
        "target": 3.1,
        "left": 6,
        "right": 6,
        "center": 5
      },
      {
        "target": 5,
        "left": 7,
        "right": 8,
        "center": 7
      },
      {
        "target": 6,
        "left": 8,
        "right": 8,
        "center": 7
      }
    ],
    "scaled": [
      [1, 3, 1],
      [3, 5, 3],
      [6, 6, 5]
    ],
    "descending": [
      [5, 7, 5],
      [3, 5, 3],
      [1, 2, 1]
    ],
    "restricted": [3, 5],
    "accessorLength": 1,
    "comparatorLength": 2
  },
  "10-bisector-explicit-mode.ajs": {
    "sortedIds": [5, 1, 3, 2, 6, 0, 4, 7],
    "ascendingResults": [
      {
        "target": -1,
        "left": 0,
        "right": 0,
        "center": 0
      },
      {
        "target": 0,
        "left": 0,
        "right": 1,
        "center": 0
      },
      {
        "target": 1.5,
        "left": 1,
        "right": 3,
        "center": 1
      },
      {
        "target": 1.75,
        "left": 3,
        "right": 3,
        "center": 3
      },
      {
        "target": 2,
        "left": 3,
        "right": 5,
        "center": 3
      },
      {
        "target": 3.1,
        "left": 6,
        "right": 6,
        "center": 5
      },
      {
        "target": 5,
        "left": 7,
        "right": 8,
        "center": 7
      },
      {
        "target": 6,
        "left": 8,
        "right": 8,
        "center": 7
      }
    ],
    "scaled": [
      [1, 3, 1],
      [3, 5, 3],
      [6, 6, 5]
    ],
    "descending": [
      [5, 7, 5],
      [3, 5, 3],
      [1, 2, 1]
    ],
    "restricted": [3, 5]
  },
  "11-function-arity-reduction.ajs": {
    "ordinary": 2,
    "arrow": 1,
    "generator": 1,
    "result": 5
  }
}
```

### Current-source RED (base implementation)

```jsonl
{"filename":"08-bisector-stable-ordering.ajs","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[0,0,0],[0,0,0],[0,0,0]],"restricted":[3,5],"accessorLength":{"$undefined":true},"comparatorLength":{"$undefined":true}}}
{"filename":"10-bisector-explicit-mode.ajs","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5]}}
{"filename":"11-function-arity-reduction.ajs","ok":true,"output":{"ordinary":{"$undefined":true},"arrow":{"$undefined":true},"generator":{"$undefined":true},"result":5}}
```

### Current-source GREEN (patched implementation)

```jsonl
{"filename":"08-bisector-stable-ordering.ajs","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5],"accessorLength":1,"comparatorLength":2}}
{"filename":"10-bisector-explicit-mode.ajs","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5]}}
{"filename":"11-function-arity-reduction.ajs","ok":true,"output":{"ordinary":2,"arrow":1,"generator":1,"result":5}}
```

The first ad hoc SafeJS driver omitted entryPointArgs and therefore did not invoke the default exports; all three returnValue fields were undefined. That driver-only result is not defect evidence. The corrected driver above supplies entryPointArgs: [] and is the driver used for both retained RED/GREEN outputs. Neither source nor native expectations changed.

## Changed code manifest

Paths are relative to the isolated clone. These are the exact postimage SHA-256 values; the separate local manifest also includes base hashes, the final plan-document hash, and local evidence hashes.

| Path                                                | SHA-256                                                          |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| packages/safejs/src/interp/async.ts                 | fc4231ca5f6d03af845c9b19127579d3564bf9cc8ae418d499bac6b8d39ae6cc |
| packages/safejs/src/interp/function-arity.test.ts   | 8c67f0352ddb4f9efa3ec8a4b63ae8ef266a8e979d9654c6f4dfbb25ce5b9a55 |
| packages/safejs/src/interp/methods/function.test.ts | 2738d2efa22916cbe4d2d52e9c0b7a9103bcd7a4b00c221ada5a317c51ef1254 |
| packages/safejs/src/interp/methods/function.ts      | 1543db210f9c40a66148e838973434c85c10bd9e47d46200731e48a6453b5826 |
| packages/safejs/src/interp/values.ts                | 1e027e9c9c100b0849b7b8e4ab02b747181f63ce1383e9e467fecc37e76ad4a6 |
| packages/safejs/src/parse/bindings.ts               | 6c973479a5340cebee625ad0c81bb134598b3c128599577d97024c5552e74acb |
| packages/safejs/src/snapshot/restore.test.ts        | 3d08664efcb320d916553c1e37d60c5eea6d2d7515eaafa648663a2117b82f43 |
| packages/safejs/src/snapshot/restore.ts             | e1fbab08bc2f6bd6b1fbdf3c50626909ff4d57068053cf6bdd08a9a8f1e6819a |

## Separate-validator handoff

1. The coordinator assigns the independent validator; this worker launches no other agents. Validate against the base SHA and exact file hashes, not whatever happens to be on another clone's main.
2. Reconfirm the three embedded original source hashes without reading the archive: parse the regression file's originalBisector, explicitModeControl, and originalReduction template literals. If comparing to the original audit, bootstrap the exact 38-path/security exclusion guard first and read only the three explicit allowed paths above.
3. In an independently owned clean clone, reproduce the focused RED with only the three test-file changes and the base production code. Do not reset/stash/reverse this worker's live tree. Expected: 24 failures, 73 passes. Then integrate only the five production changes and reproduce 97 focused passes plus the 797-test broad command and SafeJS typecheck.
4. Repeat bounded native-first/current-TS execution of all three full originals, retaining all fields. Require the nine descending indices [[5,7,5],[3,5,3],[1,2,1]], arities 1/2 in the parent, 2/1/1 in the reduction, and unchanged stable-sort, ascending, scaled, restricted, and explicit-mode-control outputs.
5. The serial publisher must integrate diffs rather than overwrite whole files, checking preimages because collection/array metadata workers may touch shared runtime files. This patch does not edit interpreter.ts, but values.ts, methods/function.ts, and snapshot/restore.ts still need overlap review. Independently revalidate the combined result before any publication.

Risks and limits: metadata is intentionally limited to source functions/restored source closures and derived source binding; built-in/host method arities, general function mutation/reflection, and existing snapshot limitations are not newly promised. No collection or array-metadata defect is fixed here. Existing dependency audit warnings remain outside this issue. The whole remediation goal continues.

Local-only evidence is under out/safejs-remediation/num-001 (red.log, green.log, broad.log, typecheck.log, eslint.log, and handoff.json). Do not stage these local logs or generated dependency build outputs as source changes. The plan belongs with the eight source/test paths when the separately authorized publisher eventually integrates this issue. No commit or push was performed by this worker.

## Current-main integration evidence — August 29, 2026

This appendix is the integration author's evidence, not Aquinas's independent merged validation or publication approval. The entire historical author plan above is preserved byte-for-byte as the approved 17,832-byte prefix (SHA-256 a64568501f39676bd0fefc3102dafe3e969877fd26ab5fbadf6f352102a55760). The separate validator plan and every approved code/test assertion remain unchanged. Only this author-plan appendix is new.

### Isolation and approved input

- New workspace: /Users/kjopek/Workspace/poe-code-safejs-function-arity-integrated. Cloned single-branch main from the publisher's origin, git@github.com:poe-platform/poe-code.git, then successfully ran git -c pull.rebase=false pull --ff-only before integration.
- Pinned current base: 7fec2826bac2933483c2579ff47d2264f8e1f422, the published ARRAYOWN/call-order change itself; ancestor verification succeeded. The branch remains main at that exact SHA, with nothing staged.
- Incoming approved manifest: /Users/kjopek/Workspace/poe-code-safejs-function-arity/out/safejs-remediation/num-001-validation/candidate/manifest.json; SHA-256 ab188c65b988fbc10a93802350ef6c2a33c980d9d7855ed9f8571c9560c7e6b1. All eleven postimages and seven old-base preimages were rehashed and verified against old base bc85287c08cfa8796af80c76d0dd8dd2ddf7347b.
- The original author clone/captures, original repository, publisher, array integration evidence, and shared remediation workspace are read-only. No feature branch, stash, reset, commit, push, README addition, inline code comment, or additional agent was created.
- No original audit directory or payload was read during this integration. The three original numerical examples are extracted from the verified captured regression file, not reread from the audit. Any later audit access still requires the exact 38-path exclusion and entire-security-directory guard before an explicit nonexcluded allowlist read.
- Local evidence is ignored through a clone-local .git/info/exclude entry for /out/safejs-remediation/num-001-integration/. No shared or tracked ignore rule is edited.

### Three-way result and preservation

Every incoming existing-file preimage is still identical on this pinned current main. Dry-run git merge-file -p --diff3 comparisons therefore produce eleven conflict-free results: seven existing files and four additions. There are zero textual conflicts and no manual source resolutions. The actual edits use apply_patch hunks derived from the verified three-way result, not a copy of an old interpreter file.

The five production files add the same approved 25 lines for AST-derived arity, live/generator closure metadata, bound arity, and restored-source arity. All nine TypeScript postimages and the validator-plan postimage equal the approved candidate. No source workaround or changed assertion is used to obtain GREEN. The author plan has only this append-only evidence.

All 32 SafeJS source/test files changed by published commits between bc85287c and 7fec2826 are SHA-256-identical before/after this integration and full build. In particular, interpreter.ts, iteration.ts, methods/array.ts, globals/object-array.ts, methods/string.ts, parser/tokenizer, and loader files are untouched. This preserves the published COLL cursor/snapshot changes, ARRAYOWN own access and call ordering, OBJ001 aliases, MC003 numeric constants, TREE contextual from, HI offsets, and STR03 replacement implementation. Behavioral controls below additionally check these paths; byte preservation alone is not the behavioral claim.

Current-main preimages, source/hunk reconciliation, the approved input manifest, and protected-file hashes are retained under out/safejs-remediation/num-001-integration. No whole-file interpreter replacement occurred.

### Genuine current-base RED and merged GREEN

Only the four approved test files were installed for RED. All five production files were verified against the current-main preimages; no in-memory old-code override or simulated revert was used.

| Gate                                        | Result                                                                                   |
| ------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Current-base focused RED                    | 49 failed, 47 passed, 26 predeclared non-probe exclusions; 122 total, four files; exit 1 |
| Same focused command after production hunks | 96 passed, 26 same exclusions; 122 total, four files; exit 0                             |
| ARRAYOWN author + independent validator     | 26/26 passed, two files                                                                  |
| Published generic call-order controls       | 15/15 passed                                                                             |
| Published COLL cursor controls              | 136/136 passed, two files                                                                |
| Published OBJ001 alias controls             | 40/40 passed, two files                                                                  |
| Published MC003 numeric controls            | 79/79 passed, two files                                                                  |
| Published TREE/HI/STR03/MC001 controls      | 369/369 passed, eight files                                                              |
| Combined broad functional suite             | 1598 passed, 0 failed, 82 explicitly filtered; 1680 total, 39 files                      |

The focused command uses the approved NUM-001 non-probe exclusion list. The broad command combines that list with the prior published ARRAYOWN functional selector, with multiline-safe matching so multiline cases are not accidentally omitted. Exact selectors and all 82 excluded test names are retained in suite-scope.json, combined-suite-scope.json, and combined-broad-summary.json. Required published control groups also run separately without filtering. No security/prototype probe campaign, adversarial suite, actual LLM call, or guest filesystem/network/process capability is introduced. This is not a claim that an unfiltered whole-repository suite ran.

Exact command argv, pinned cwd, timestamps, timeout, exit, signal, stdout, and stderr are retained for each command JSON. All runtime/build/check commands use env -u TERM. The focused command is vitest run over interp/function-arity.test.ts, interp/methods/function.test.ts, snapshot/restore.test.ts, and interp/num-001-validation.test.ts with the recorded selector and verbose reporter.

### Full unchanged numerical originals

Before current-base SafeJS execution, bounded native references were established from all three exact captured template literals (node:vm, 1,000-ms timeout). SafeJS receives the unchanged module sources, entryPointArgs: [], a 500,000-step/128-call-depth budget, the original finite string/array/data limits, and a 5,000-ms interpreter deadline. The host child uses current TypeScript imports, a 15,000-ms timeout, and a 192-MiB old-space cap. No dist import is used for this verification.

Current-base RED silently returns all nine descending indices as zero and undefined arities; the explicit-mode control already matches native. Merged GREEN matches every native field exactly for the complete original bisector, full explicit-mode control, and original ordinary/default-rest-arrow/generator reduction. This includes stable duplicate ordering, ascending queries, captured-scale updates, restricted intervals, descending [[5,7,5],[3,5,3],[1,2,1]], parent arities 1/2, and reduction arities 2/1/1 with result 5. Source hashes remain the three anchors recorded above.

Full current-base RED return values, with undefined preserved explicitly:

```jsonl
{"name":"originalBisector","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[0,0,0],[0,0,0],[0,0,0]],"restricted":[3,5],"accessorLength":{"$undefined":true},"comparatorLength":{"$undefined":true}}}
{"name":"explicitModeControl","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5]}}
{"name":"originalReduction","ok":true,"output":{"ordinary":{"$undefined":true},"arrow":{"$undefined":true},"generator":{"$undefined":true},"result":5}}
```

Full merged GREEN return values (all exactly equal to the new bounded native references):

```jsonl
{"name":"originalBisector","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5],"accessorLength":1,"comparatorLength":2}}
{"name":"explicitModeControl","ok":true,"output":{"sortedIds":[5,1,3,2,6,0,4,7],"ascendingResults":[{"target":-1,"left":0,"right":0,"center":0},{"target":0,"left":0,"right":1,"center":0},{"target":1.5,"left":1,"right":3,"center":1},{"target":1.75,"left":3,"right":3,"center":3},{"target":2,"left":3,"right":5,"center":3},{"target":3.1,"left":6,"right":6,"center":5},{"target":5,"left":7,"right":8,"center":7},{"target":6,"left":8,"right":8,"center":7}],"scaled":[[1,3,1],[3,5,3],[6,6,5]],"descending":[[5,7,5],[3,5,3],[1,2,1]],"restricted":[3,5]}}
{"name":"originalReduction","ok":true,"output":{"ordinary":2,"arrow":1,"generator":1,"result":5}}
```

The native-expected.json, current-base-originals-red.json, and merged-originals-green.json captures retain full outputs, input hashes, and exact driver argv. The existing frozen author/validator tests cover defaults, rest, nested destructuring, non-evaluation of defaults/computed keys, bound/rebound functions, call/apply receivers, constructors, async forms, generators, and snapshot restore. Their assertions were not rewritten for this current base.

### IP002 is an explicit dependency

The old validator's async-computed shorthand observation remains historical evidence. On this pinned base and after the NUM-001 merge, parsing return ({ async ["load"](value) {} }).load.length; still throws ParseError: Expected '}' at line 1, column 17. Both bounded local observations are retained. The current parser is byte-identical before/after integration.

The approved IP002 async-computed parser fix is a separate publication-queue dependency, not present on this pinned base. No parser source or arity fixture is changed to work around it; the prior validated matrix remains exactly as captured. NUM-001 does not claim to fix or validate that combined form. When IP002 is integrated, Aquinas or the serial publisher must validate the combined parser/arity behavior against that newer pinned base. This statement does not assert the state of a later remote main.

### Build, configured checks, and local artifacts

- SKIP_SYNC_SKILLS=1 npm ci succeeds with pinned dependencies (548 packages added). The unchanged lock reports 10 dependency vulnerabilities; no upgrade, audit fix, or security research is attempted.
- The shared setup's three explicit dependency filters succeed: 21/21 tasks.
- env -u TERM npm run build succeeds: 67/67 tasks, 27.034-second Turbo task time, followed by root plan/harness schema generation and bundling.
- SafeJS package source tsc --noEmit passes. A TypeScript program using the package's parsed configuration, noEmit: true, and both newly added regression test roots reports zero diagnostics. This is not an unconfigured legacy-test typing claim.
- Configured npm run lint:types, npm run lint:eslint, and npm run lint:packages all pass; package lint checks 17 rules over 68 packages. Prettier checks all nine code/test publishables without rewriting frozen captures. git diff --check passes.
- The first new-test typecheck driver had an incorrectly escaped newline in its command string and failed JavaScript parsing before running TypeScript. Its original failure capture is retained as configured-new-test-types.json. The corrected driver uses ts.sys.newLine and passes as configured-new-test-types-green.json; no source/test/config change was made to obtain that pass.
- No CLI visual presentation changes; screenshot validation does not apply. No full-repository test, release, or independent merged-validation result is claimed.

The full build creates these four local untracked font assets. They remain untouched, are not publishables, and are excluded from the frozen issue manifest:

- packages/terminal-pilot/assets/jetbrains-mono-400-italic.ttf
- packages/terminal-pilot/assets/jetbrains-mono-400-normal.ttf
- packages/terminal-pilot/assets/jetbrains-mono-700-italic.ttf
- packages/terminal-pilot/assets/jetbrains-mono-700-normal.ttf

No tracked package manifest, lockfile, generated workflow, or schema diff remains. No cleanup of another worker's changes is performed.

### Frozen candidate and Aquinas handoff

Exactly eleven publishables are frozen in files/ under out/safejs-remediation/num-001-integration, with seven current-main preimages in preimages/ and explicit absence for the four additions. manifest.json records base SHA, approved-input SHA, path ownership, byte counts, raw-byte SHA-256, protected published hashes, all evidence-file hashes, and the author-plan prefix rule. The final capture's files are read-only and its directories are non-writable after hashing; hashes remain the authoritative mutation check, not a claim of unbreakable filesystem immutability.

Aquinas must independently verify the final manifest and bytes, recheck base/ARRAYOWN ancestry and all current preimages, reproduce the tests-only current-base RED and merged GREEN in an independently owned tree, rerun the complete numerical anchors and published controls, and repeat configured gates against the exact integrated candidate. The serial publisher must resolve any newer-main divergence by diff/preimage reconciliation and independently revalidate the combined result. Do not overwrite current runtime files with old whole-file captures.

This integration is ready for that separately assigned validation only. No commit or push occurred, nothing is published, and the wider remediation goal remains open.
