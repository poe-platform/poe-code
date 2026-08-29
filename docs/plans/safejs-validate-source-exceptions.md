# Independent SOURCE-EXCEPTION-COERCION validation — AW-001 / AW-002

## Verdict

**READY for the exact isolated candidate only.** No production blocker found. This is independent validation by a delegated worker, not author Ptolemy, not publication approval and not a verdict on any later integrated interpreter candidate. No nested agents. Publisher must three-way-integrate serially and perform fresh integrated validation after other interpreter patches land.

Workdir: `/Users/kjopek/Workspace/poe-code-safejs-source-exceptions`.
Base and branch: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`, `main`.
Author plan SHA-256: `0f9469388a9152a7e58b247f71243c71cdc0756b65d883d58fc4cf548c236a8a`.

All five frozen author paths remained byte-identical throughout validation. The only validator-owned source/doc changes are `packages/safejs/src/interp/source-exceptions-validation.test.ts` and `docs/plans/safejs-validate-source-exceptions.md`. All other validator writes are under `out/safejs-remediation/source-exceptions-validation/` and were made with apply_patch. No production, README, master-plan, Git index/branch/commit, other-clone, or original-audit writes; no push/release.

## Audit boundary and source integrity

Read ancestor and root AGENTS instructions as a delegated worker. No deeper applicable instruction files existed. After an audit-root filename-only listing, read only inventory-verification metadata and establish its exact 38 exclusions plus the entire security directory before any functional audit payload. The complete list is retained in `out/safejs-remediation/source-exceptions-validation/bootstrap.json`. There were zero excluded payload reads, hashes, displays, or executions.

Subsequent audit reads were explicitly limited to REPORT.md, async-workflows/REPORT.md, async-value-review/REVIEW.md and the thirteen paths in the original-results section. No broad family/audit search, evidence archive crawl, security probe, LLM, or guest real IO. Both author and validator test embeddings match all thirteen original source bytes, including final newlines. Ordinary records were not rewritten as Error instances.

## Independent evidence and sensitivity

- Ran the thirteen original sources natively first in a bounded Node child. Then ran current TypeScript imports, never SafeJS dist. All thirteen complete return objects and complete ordered tick logs match; see full expected/actual below and `out/safejs-remediation/source-exceptions-validation/original-expected-actual.json`.
- Independently reproduced **10 mismatches / 13** using an in-memory loader overlay of exactly the two base production preimages obtained with read-only git show. The hook records both loaded preimage hashes and byte lengths. No checkout, working-tree swap, version-marker edit, fabricated migration proof, or production test double. Base expected/actual and complete command are retained in `out/safejs-remediation/source-exceptions-validation/base-expected-actual.json` and base-originals.json.
- The dedicated validator suite contains **98 tests**: 13 original workflows, 30 source-value propagation cases, 40 finite capture/restoration cases, and 15 host/public boundary controls. The author's 97 tests were not changed and also pass inside the final focused gate.
- Source matrix: DomainFailure-, Error-, and TypeError-shaped ordinary records; plain record; genuine TypeError; string, number, false, null and undefined. Propagation crosses two synchronous functions, two async functions/await, and rejection/rethrow/finally. Checks cover SAME source identity, closure readers, context/cause/array aliases, complete ordinary own-key lists, name/message/stack/code/retryable/optional/zero/disabled metadata, annotation visibility, caught-to-original mutations and original-to-caught mutations. Genuine Error brand is preserved; ordinary Error-shaped records do not acquire it.
- Host controls preserve registered TypeError metadata but copy its nested graph; normalize ordinary host rejection records on both synchronous and async paths; and keep host-returned objects copied while preserving their later source-local thrown aliases. Public normalization still rejects unhandled values with name/message/stack/span, preserves supported TypeError naming, normalizes unknown names, serializes plain-object messages, and retains ok:false diagnostic / ok:true return envelopes.

## Finite capture and compatibility scope

All **40 / 40** capture cases independently match native output both uninterrupted and after restoration. Each of the ten source values is checked before catch and inside catch after mutations, using both next-yield dump and current capture. Closure readers, source reason, caught reason, nested context, cause and array aliases remain coherent. Full native/current outputs, serialized snapshots, snapshot SHA-256/byte counts and source inputs are in captures-native.json, captures-current.json, captures-summary.json and capture-inputs.json.

Next-yield controls use a declared pure host operation with re-issue policy. Positive current-capture controls use a finite low-level closure/promise gate so they do not attempt capture inside an active injected host call. That boundary intentionally rejects with SandboxError/reentry; a separate positive guard test now asserts it. This validation does **not** claim active injected-host-call current capture is supported.

Every captured envelope retains current DUMP_FORMAT_VERSION = 1 and EXECUTION_SEMANTICS = jobs-v6 without edits. restore.ts and snapshot/dump-format.ts are SHA-identical to base. Existing dump, restore, snapshot, error-data, migration/validation and host replay tests are included in the relevant broad gate. No archived historical snapshot was read or migrated, and arbitrary historical error-record compatibility is not certified beyond current contracts.

## Actual gates and counts

Runtime: Node v22.22.2, TypeScript 5.9.3, Vitest 3.2.6. All test/type/lint/format gates below used env -u TERM; no Ctrl-D test edits or terminal workarounds in test code.

| Gate                                                             | Result                                                                              |
| ---------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Independent initial attempt                                      | 72 passed / 25 failed; incorrect validator assumptions retained and explained below |
| Independent corrected attempt                                    | 98 passed / 0 failed                                                                |
| Final focused exception/interpreter/async/host/error suite       | 847 passed / 0 failed, 12 files                                                     |
| Relevant broad SafeJS + agent-harness + toolcraft-codemode suite | 4234 passed / 0 failed / 34 declared skips; 154 files represented                   |
| SafeJS package typecheck                                         | exit 0                                                                              |
| Strict independent + both author test typecheck                  | exit 0                                                                              |
| ESLint all five changed TypeScript files                         | exit 0                                                                              |
| Prettier all frozen author files and independent test            | exit 0                                                                              |
| git diff --check                                                 | exit 0                                                                              |
| Full original/native-current comparison                          | 13 matched / 13, including full logs                                                |
| Read-only base-original sensitivity check                        | 10 mismatched / 13                                                                  |
| Finite next/current capture + restore native comparison          | 40 matched / 40                                                                     |

The 34 existing skips are 33 recorded node/memfs conformance gaps and one opt-in parser fuzz case. Full names/statuses are in gate-summary.json; none were added, removed, weakened or relabeled by the validator. A narrowly filtered diagnostic run reports 96 filtered-out tests separately; those are not broad-suite declared skips.

Exact command arrays, timestamps, exit statuses and full stdout/stderr are retained in named JSON evidence records. Commands executed from the workdir:

```sh
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/exceptions.test.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts packages/safejs/src/interp/source-exceptions-validation.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/async.test.ts packages/safejs/src/interp/generator.test.ts packages/safejs/src/interp/promise.test.ts packages/safejs/src/interp/host-bridge.test.ts packages/safejs/src/error --reporter=json
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src packages/agent-harness/src packages/toolcraft-codemode/src --reporter=json
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM ./node_modules/.bin/tsc --noEmit --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --skipLibCheck --esModuleInterop --resolveJsonModule --types node,vitest/globals packages/safejs/src/interp/source-exceptions-validation.test.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts
env -u TERM ./node_modules/.bin/eslint packages/safejs/src/interp/exceptions.ts packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts packages/safejs/src/interp/source-exceptions-validation.test.ts
env -u TERM ./node_modules/.bin/prettier --check packages/safejs/src/interp/exceptions.ts packages/safejs/src/interp/interpreter.ts packages/safejs/src/interp/source-exceptions.test.ts packages/safejs/src/interp/source-exceptions.boundaries.test.ts docs/plans/safejs-fix-source-exceptions.md packages/safejs/src/interp/source-exceptions-validation.test.ts
git diff --check
```

Native/source children use a 192 MiB heap cap, a 10-second parent timeout, at most 100 pure tick calls per original and a 200000-step SafeJS budget; capture cases use 10000 steps. Exact inline programs are retained, not substituted with illustrative commands: native-originals.json, current-originals.json, base-originals.json, captures-native.json and captures-current.json. Original child stdin is the workflows array in native-originals.json; capture stdin is retained in capture-inputs.json. No executable QA script was added; this document is the QA plan/report.

## Preserved failed attempts and test-only corrections

The first independent suite returned 72 pass / 25 fail. Twenty current-capture failures were the existing active injected-host-call reentry guard. Five genuine-TypeError cases demanded native Object.keys semantics even though SafeJS stores enumerable built-in name/message/stack fields. The detailed diff showed only those three extra keys; all requested error data, identity and mutation checks matched. The revised tests keep exact ordinary-record own-key comparison, explicit genuine Error metadata/brand comparisons, and a separate active-host guard assertion. They do not certify native Error property descriptor parity.

No author repair was made or needed. The initial source is retained as test-attempt-1-source.json; complete failures are focused-attempt-1.json and genuine-error-attempt-1.json. Corrected runtime suite passed all 98 before typing. Strict typing then found two validator Promise<void> mismatches; the preimage, diagnostics and explicit-undefined typing-only correction are retained. One patch preimage mismatch changed nothing.

Other setup failures (TypeScript module namespace, as-const AST traversal, nested template interpolation, REPL string-code generation) occurred before their intended writes. One large broad JSON write hit apply_patch argv E2BIG; that attempt's returned status/stdout were not retained, so no gate result is claimed for it. The broad command was rerun and its full successful output was preserved through apply_patch stdin. These failures and the corrected skipped-status summary are recorded in preserved-attempts.json; no failure evidence was deleted.

## Frozen files and candidate handoff

SHA-256 values are byte hashes, not git blob IDs. Base preimages are from bc85287c08cfa8796af80c76d0dd8dd2ddf7347b. New files are ABSENT at base.

| Path                                                              | Base preimage SHA-256                                              | Candidate SHA-256                                                  | Bytes                       |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ | ------------------------------------------------------------------ | --------------------------- |
| `packages/safejs/src/interp/exceptions.ts`                        | `5ed3c8b300df2eb36d8e51afa8cfe6ae9bbe82b7c1c9586d16d9eff4abcdecbf` | `079e267b3c55d4f3dac843c3d70faea15e2fe7cb352ba734b532b8bdbbf89127` | 19131                       |
| `packages/safejs/src/interp/interpreter.ts`                       | `bcf749b3e19160ac30d7448fc03f2b65e85bef9b2cb217952badea504a161e61` | `4543a54c54ddc1a94f8c1a8a389360ed0bc89d1fb6ef714b2503f57ab2fdd196` | 97546                       |
| `packages/safejs/src/interp/source-exceptions.test.ts`            | ABSENT                                                             | `e0de4f1e1532ac2b43ff8776b234fb1ca9f4be95629baebd2725b7adaa423075` | 24325                       |
| `packages/safejs/src/interp/source-exceptions.boundaries.test.ts` | ABSENT                                                             | `1bda65290bc33a760febf4976df4fb3bb4aa107eed169c588ae930d67d21e99a` | 6899                        |
| `docs/plans/safejs-fix-source-exceptions.md`                      | ABSENT                                                             | `0f9469388a9152a7e58b247f71243c71cdc0756b65d883d58fc4cf548c236a8a` | 64200                       |
| `packages/safejs/src/interp/source-exceptions-validation.test.ts` | ABSENT                                                             | `361a52e86d37a64db0fe4606df2e687338823b47310b271c7b47d54e38a84670` | 37015                       |
| docs/plans/safejs-validate-source-exceptions.md                   | ABSENT                                                             | External candidate manifest (avoids self-reference)                | External candidate manifest |

Unchanged protected inputs: package.json SHA-256 a3e5638abe5f1df44298e105db2a25c93ad6d0d26ef1d8ab2f93cfa466f11b99; package-lock.json 297af2f85db1eeedaca7a33f64a4ec95bed39754d42a1e787a236c4af55c29c7. Full protected hashes/bytes are in protected-manifest-final.json.

The finalized content-addressed candidate includes byte-exact copies of all seven author-plus-validator source/doc files and the two available base preimages, with explicit ABSENT preimages for the five new files. candidate-manifest.json records base SHA, original paths, copied paths, base/post SHA-256 and byte sizes, and evidence-manifest identity. evidence-manifest.json inventories all retained validation evidence, including failures. Final manifest hashes are reported at handoff to avoid self-referential file hashes. Treat the candidate as sealed; do not modify it in place.

## Limits

READY applies only to these hashes on the isolated base. It does not validate any merged interpreter patches, publisher main, release build, production deployment, all repository tests, separate toolcraft Ctrl-D tests, or live model execution. No root full-build/full-test result is claimed. Full integrated validation remains mandatory after serial three-way merge.

This is bounded functional exception/alias validation, not a general security assessment, adversarial audit, retained-callback lifetime proof, whole-upstream compatibility claim, or exhaustive snapshot migration certification. No CLI visual changes were made; screenshots were not applicable. Genuine Error enumerability remains the current SafeJS contract rather than a new promise of native descriptor equivalence. No unrelated repair or history rewrite occurred.

## Full original expected and actual

Every object below is complete, including complete ordered host tick logs. No fields are elided. The comparison marker {"$undefined":true} denotes JavaScript undefined only in evidence encoding, never a source rewrite. Full baseline actual objects are also retained in base-expected-actual.json.

### 01-waterfall-identity

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/01-waterfall-identity.js`\
SHA-256: `ebad28958264b8a06774ee9358f83e7ca228d8faef66ebeea866f4073be94e10`

```json
{
  "expected": {
    "id": "01-waterfall-identity",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": [true, true, true],
        "caughtIdentity": true,
        "shared": { "name": "ledger", "entries": [2, 5, 11], "total": 10 },
        "trace": [
          ["stage", 0],
          ["stage", 1],
          ["identity", true, true, true, true],
          ["stage", 2],
          ["stage", 3],
          ["stage", 0],
          ["stage", 1],
          ["closed", 10]
        ]
      }
    },
    "calls": ["waterfall:load", "waterfall:commit", "waterfall:fail"]
  },
  "actual": {
    "id": "01-waterfall-identity",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": [true, true, true],
        "caughtIdentity": true,
        "shared": { "name": "ledger", "entries": [2, 5, 11], "total": 10 },
        "trace": [
          ["stage", 0],
          ["stage", 1],
          ["identity", true, true, true, true],
          ["stage", 2],
          ["stage", 3],
          ["stage", 0],
          ["stage", 1],
          ["closed", 10]
        ]
      }
    },
    "calls": ["waterfall:load", "waterfall:commit", "waterfall:fail"]
  },
  "matched": true
}
```

### 02-auto-dependency-closures

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/02-auto-dependency-closures.js`\
SHA-256: `6077f3c3188366f56fc83f565e23c9a390b3e189a79cb6bdd9fe85adece97eec`

```json
{
  "expected": {
    "id": "02-auto-dependency-closures",
    "execution": {
      "ok": true,
      "returnValue": {
        "result": {
          "summary": { "identity": true, "values": [13, 13], "labels": [2, 4, 7], "owner": true },
          "finished": 7,
          "peak": 2
        },
        "origin": { "name": "catalog", "revision": 3 },
        "trace": [
          ["start", "seed"],
          ["start", "weights"],
          ["done", "seed"],
          ["start", "left"],
          ["done", "weights"],
          ["start", "right"],
          ["done", "left"],
          ["start", "labels"],
          ["done", "right"],
          ["start", "combine"],
          ["done", "labels"],
          ["done", "combine"],
          ["start", "summary"],
          ["done", "summary"]
        ]
      }
    },
    "calls": ["seed", "weights:a", "weights:b", "left", "right", "labels", "summary"]
  },
  "actual": {
    "id": "02-auto-dependency-closures",
    "execution": {
      "ok": true,
      "returnValue": {
        "result": {
          "summary": { "identity": true, "values": [13, 13], "labels": [2, 4, 7], "owner": true },
          "finished": 7,
          "peak": 2
        },
        "origin": { "name": "catalog", "revision": 3 },
        "trace": [
          ["start", "seed"],
          ["start", "weights"],
          ["done", "seed"],
          ["start", "left"],
          ["done", "weights"],
          ["start", "right"],
          ["done", "left"],
          ["start", "labels"],
          ["done", "right"],
          ["start", "combine"],
          ["done", "labels"],
          ["done", "combine"],
          ["start", "summary"],
          ["done", "summary"]
        ]
      }
    },
    "calls": ["seed", "weights:a", "weights:b", "left", "right", "labels", "summary"]
  },
  "matched": true
}
```

### 03-maplimit-lexical-state

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/03-maplimit-lexical-state.js`\
SHA-256: `0dc1377c893052a74fe3bb5a8003a2baf3e879ad53a9a782d7da4829d4ca32b4`

```json
{
  "expected": {
    "id": "03-maplimit-lexical-state",
    "execution": {
      "ok": true,
      "returnValue": {
        "checks": [
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [0, 0, 105, 0],
              [0, 1, 105, 0],
              [0, 2, 105, 0]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [1, 0, 110, 1],
              [1, 1, 110, 1],
              [1, 2, 110, 1]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [2, 0, 116, 2],
              [2, 1, 116, 2],
              [2, 2, 116, 2]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [3, 0, 122, 0],
              [3, 1, 122, 0],
              [3, 2, 122, 0]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [4, 0, 130, 1],
              [4, 1, 130, 1],
              [4, 2, 130, 1]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [5, 0, 136, 2],
              [5, 1, 136, 2],
              [5, 2, 136, 2]
            ]
          }
        ],
        "completed": 6,
        "trace": [
          ["finish", 0, 0],
          ["finish", 1, 1],
          ["finish", 2, 2],
          ["finish", 3, 0],
          ["finish", 4, 1],
          ["finish", 5, 2]
        ]
      }
    },
    "calls": [
      "map:0:0",
      "map:1:0",
      "map:2:0",
      "map:0:1",
      "map:1:1",
      "map:2:1",
      "map:0:2",
      "map:1:2",
      "map:2:2",
      "map:3:0",
      "map:4:0",
      "map:5:0",
      "map:3:1",
      "map:4:1",
      "map:5:1",
      "map:3:2",
      "map:4:2",
      "map:5:2",
      "verify:0",
      "verify:1",
      "verify:2",
      "verify:3",
      "verify:4",
      "verify:5"
    ]
  },
  "actual": {
    "id": "03-maplimit-lexical-state",
    "execution": {
      "ok": true,
      "returnValue": {
        "checks": [
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [0, 0, 105, 0],
              [0, 1, 105, 0],
              [0, 2, 105, 0]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [1, 0, 110, 1],
              [1, 1, 110, 1],
              [1, 2, 110, 1]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [2, 0, 116, 2],
              [2, 1, 116, 2],
              [2, 2, 116, 2]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [3, 0, 122, 0],
              [3, 1, 122, 0],
              [3, 2, 122, 0]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [4, 0, 130, 1],
              [4, 1, 130, 1],
              [4, 2, 130, 1]
            ]
          },
          {
            "sameLocal": true,
            "sameFunction": true,
            "sameSession": true,
            "readers": [
              [5, 0, 136, 2],
              [5, 1, 136, 2],
              [5, 2, 136, 2]
            ]
          }
        ],
        "completed": 6,
        "trace": [
          ["finish", 0, 0],
          ["finish", 1, 1],
          ["finish", 2, 2],
          ["finish", 3, 0],
          ["finish", 4, 1],
          ["finish", 5, 2]
        ]
      }
    },
    "calls": [
      "map:0:0",
      "map:1:0",
      "map:2:0",
      "map:0:1",
      "map:1:1",
      "map:2:1",
      "map:0:2",
      "map:1:2",
      "map:2:2",
      "map:3:0",
      "map:4:0",
      "map:5:0",
      "map:3:1",
      "map:4:1",
      "map:5:1",
      "map:3:2",
      "map:4:2",
      "map:5:2",
      "verify:0",
      "verify:1",
      "verify:2",
      "verify:3",
      "verify:4",
      "verify:5"
    ]
  },
  "matched": true
}
```

### 04-nested-finally-precedence

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/04-nested-finally-precedence.js`\
SHA-256: `ab59bab7459aac520728a431bf647e82fadd8fb026a701117aff68194c20ae20`

```json
{
  "expected": {
    "id": "04-nested-finally-precedence",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "name": "success", "value": "body-value", "original": true, "overridden": false },
          {
            "name": "body",
            "error": "body",
            "body": true,
            "inner": false,
            "outer": false,
            "chain": false
          },
          {
            "name": "inner",
            "error": "inner-cleanup",
            "body": false,
            "inner": true,
            "outer": false,
            "chain": false
          },
          {
            "name": "outer",
            "error": "outer-cleanup",
            "body": false,
            "inner": false,
            "outer": true,
            "chain": false
          },
          { "name": "override", "value": "outer-value", "original": false, "overridden": true },
          {
            "name": "chain",
            "error": "promise-finally",
            "body": false,
            "inner": false,
            "outer": false,
            "chain": true
          }
        ],
        "trace": [
          ["success", "inner-enter"],
          ["body", "inner-enter"],
          ["inner", "inner-enter"],
          ["outer", "inner-enter"],
          ["override", "inner-enter"],
          ["chain", "inner-enter"],
          ["success", "inner-exit"],
          ["success", "outer-enter"],
          ["body", "inner-exit"],
          ["body", "outer-enter"],
          ["inner", "outer-enter"],
          ["outer", "outer-enter"],
          ["override", "outer-enter"],
          ["chain", "inner-exit"],
          ["chain", "outer-enter"],
          ["success", "outer-exit"],
          ["body", "outer-exit"],
          ["inner", "outer-exit"],
          ["outer", "outer-exit"],
          ["override", "outer-exit"],
          ["chain", "outer-exit"],
          ["success", "promise-finally"],
          ["body", "promise-finally"],
          ["inner", "promise-finally"],
          ["outer", "promise-finally"],
          ["override", "promise-finally"],
          ["chain", "promise-finally"]
        ]
      }
    },
    "calls": [
      "success:body",
      "body:body",
      "inner:body",
      "outer:body",
      "override:body",
      "chain:body",
      "success:inner",
      "body:inner",
      "inner:inner",
      "outer:inner",
      "override:inner",
      "chain:inner",
      "success:outer",
      "body:outer",
      "inner:outer",
      "outer:outer",
      "override:outer",
      "chain:outer",
      "success:promise-finally",
      "body:promise-finally",
      "inner:promise-finally",
      "outer:promise-finally",
      "override:promise-finally",
      "chain:promise-finally"
    ]
  },
  "actual": {
    "id": "04-nested-finally-precedence",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "name": "success", "value": "body-value", "original": true, "overridden": false },
          {
            "name": "body",
            "error": "body",
            "body": true,
            "inner": false,
            "outer": false,
            "chain": false
          },
          {
            "name": "inner",
            "error": "inner-cleanup",
            "body": false,
            "inner": true,
            "outer": false,
            "chain": false
          },
          {
            "name": "outer",
            "error": "outer-cleanup",
            "body": false,
            "inner": false,
            "outer": true,
            "chain": false
          },
          { "name": "override", "value": "outer-value", "original": false, "overridden": true },
          {
            "name": "chain",
            "error": "promise-finally",
            "body": false,
            "inner": false,
            "outer": false,
            "chain": true
          }
        ],
        "trace": [
          ["success", "inner-enter"],
          ["body", "inner-enter"],
          ["inner", "inner-enter"],
          ["outer", "inner-enter"],
          ["override", "inner-enter"],
          ["chain", "inner-enter"],
          ["success", "inner-exit"],
          ["success", "outer-enter"],
          ["body", "inner-exit"],
          ["body", "outer-enter"],
          ["inner", "outer-enter"],
          ["outer", "outer-enter"],
          ["override", "outer-enter"],
          ["chain", "inner-exit"],
          ["chain", "outer-enter"],
          ["success", "outer-exit"],
          ["body", "outer-exit"],
          ["inner", "outer-exit"],
          ["outer", "outer-exit"],
          ["override", "outer-exit"],
          ["chain", "outer-exit"],
          ["success", "promise-finally"],
          ["body", "promise-finally"],
          ["inner", "promise-finally"],
          ["outer", "promise-finally"],
          ["override", "promise-finally"],
          ["chain", "promise-finally"]
        ]
      }
    },
    "calls": [
      "success:body",
      "body:body",
      "inner:body",
      "outer:body",
      "override:body",
      "chain:body",
      "success:inner",
      "body:inner",
      "inner:inner",
      "outer:inner",
      "override:inner",
      "chain:inner",
      "success:outer",
      "body:outer",
      "inner:outer",
      "outer:outer",
      "override:outer",
      "chain:outer",
      "success:promise-finally",
      "body:promise-finally",
      "inner:promise-finally",
      "outer:promise-finally",
      "override:promise-finally",
      "chain:promise-finally"
    ]
  },
  "matched": true
}
```

### 05-saga-delegation-cleanup

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/05-saga-delegation-cleanup.js`\
SHA-256: `3f33639877da271d3ee65523dd9859c9c2e78dadb75d80e732463582a81c4612`

```json
{
  "expected": {
    "id": "05-saga-delegation-cleanup",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "result": { "label": "normal", "value": 12 }, "effects": 4 },
          { "result": { "label": "recover", "value": 17 }, "effects": 4 },
          { "result": { "label": "cancel", "value": "cancelled" }, "effects": 3 }
        ],
        "trace": [
          ["normal", "leaf-enter"],
          ["normal", "leaf-exit"],
          ["normal", "branch-result", 12],
          ["normal", "branch-enter"],
          ["normal", "branch-exit"],
          ["recover", "caught", true],
          ["recover", "leaf-enter"],
          ["recover", "leaf-exit"],
          ["recover", "branch-result", 17],
          ["recover", "branch-enter"],
          ["recover", "branch-exit"],
          ["cancel", "leaf-enter"],
          ["cancel", "leaf-exit"],
          ["cancel", "branch-result", "cancelled"],
          ["cancel", "branch-enter"],
          ["cancel", "branch-exit"]
        ]
      }
    },
    "calls": [
      "normal:initial",
      "normal:left",
      "normal:right",
      "normal:leaf-close",
      "normal:branch-close",
      "recover:initial",
      "recover:left",
      "recover:right",
      "recover:recover",
      "recover:leaf-close",
      "recover:branch-close",
      "cancel:initial",
      "cancel:leaf-close",
      "cancel:branch-close"
    ]
  },
  "actual": {
    "id": "05-saga-delegation-cleanup",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "result": { "label": "normal", "value": 12 }, "effects": 4 },
          { "result": { "label": "recover", "value": 17 }, "effects": 4 },
          { "result": { "label": "cancel", "value": "cancelled" }, "effects": 3 }
        ],
        "trace": [
          ["normal", "leaf-enter"],
          ["normal", "leaf-exit"],
          ["normal", "branch-result", 12],
          ["normal", "branch-enter"],
          ["normal", "branch-exit"],
          ["recover", "caught", true],
          ["recover", "leaf-enter"],
          ["recover", "leaf-exit"],
          ["recover", "branch-result", 17],
          ["recover", "branch-enter"],
          ["recover", "branch-exit"],
          ["cancel", "leaf-enter"],
          ["cancel", "leaf-exit"],
          ["cancel", "branch-result", "cancelled"],
          ["cancel", "branch-enter"],
          ["cancel", "branch-exit"]
        ]
      }
    },
    "calls": [
      "normal:initial",
      "normal:left",
      "normal:right",
      "normal:leaf-close",
      "normal:branch-close",
      "recover:initial",
      "recover:left",
      "recover:right",
      "recover:recover",
      "recover:leaf-close",
      "recover:branch-close",
      "cancel:initial",
      "cancel:leaf-close",
      "cancel:branch-close"
    ]
  },
  "matched": true
}
```

### 06-scan-reduce-state

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/06-scan-reduce-state.js`\
SHA-256: `49a7fed1388eee6d59fbf52e12b4823532dd5629a4b2ece1e1c1256d8d99ea22`

```json
{
  "expected": {
    "id": "06-scan-reduce-state",
    "execution": {
      "ok": true,
      "returnValue": {
        "balance": 13,
        "names": ["open:0", "credit:1", "replace:2", "settle:3"],
        "initialBalance": 8,
        "aliases": [true, false, true, true],
        "numeric": [16],
        "numericIndexes": [1, 2],
        "empty": [[19], [], false],
        "caughtIdentity": true,
        "trace": [
          ["closed", 4, true],
          ["closed", 3, false],
          ["closed", 0, false],
          ["closed", 0, false],
          ["closed", 3, false]
        ]
      }
    },
    "calls": [
      "scan:0",
      "scan:1",
      "scan:2",
      "scan:3",
      "scan:0",
      "scan:1",
      "scan:2",
      "scan:0",
      "scan:1"
    ]
  },
  "actual": {
    "id": "06-scan-reduce-state",
    "execution": {
      "ok": true,
      "returnValue": {
        "balance": 13,
        "names": ["open:0", "credit:1", "replace:2", "settle:3"],
        "initialBalance": 8,
        "aliases": [true, false, true, true],
        "numeric": [16],
        "numericIndexes": [1, 2],
        "empty": [[19], [], false],
        "caughtIdentity": true,
        "trace": [
          ["closed", 4, true],
          ["closed", 3, false],
          ["closed", 0, false],
          ["closed", 0, false],
          ["closed", 3, false]
        ]
      }
    },
    "calls": [
      "scan:0",
      "scan:1",
      "scan:2",
      "scan:3",
      "scan:0",
      "scan:1",
      "scan:2",
      "scan:0",
      "scan:1"
    ]
  },
  "matched": true
}
```

### 07-forkjoin-last-values

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/07-forkjoin-last-values.js`\
SHA-256: `fc800f5b29ba9af6ad5baa2435639003e761a9b953a9bb55998dce45559ecfaa`

```json
{
  "expected": {
    "id": "07-forkjoin-last-values",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": {
          "emitted": true,
          "values": [{ "id": "shared-last", "value": 23 }, { "id": "shared-last", "value": 23 }, 7],
          "alias": true,
          "original": true
        },
        "empty": { "emitted": false, "values": [] },
        "noStreams": { "emitted": false, "values": [] },
        "rejectedIdentity": true,
        "trace": [
          ["first", "next"],
          ["second", "next"],
          ["third", "next"],
          ["second", "complete"],
          ["first", "next"],
          ["third", "next"],
          ["first", "complete"],
          ["third", "next"],
          ["third", "complete"],
          ["empty", "complete"],
          ["drained", "next"],
          ["drained", "next"],
          ["drained", "complete"],
          ["failing", "next"],
          ["joined", "next"],
          ["failing", "complete"],
          ["joined", "next"],
          ["joined", "complete"]
        ]
      }
    },
    "calls": [
      "first",
      "second",
      "third",
      "first",
      "third",
      "third",
      "drained",
      "drained",
      "failing",
      "joined",
      "joined"
    ]
  },
  "actual": {
    "id": "07-forkjoin-last-values",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": {
          "emitted": true,
          "values": [{ "id": "shared-last", "value": 23 }, { "id": "shared-last", "value": 23 }, 7],
          "alias": true,
          "original": true
        },
        "empty": { "emitted": false, "values": [] },
        "noStreams": { "emitted": false, "values": [] },
        "rejectedIdentity": true,
        "trace": [
          ["first", "next"],
          ["second", "next"],
          ["third", "next"],
          ["second", "complete"],
          ["first", "next"],
          ["third", "next"],
          ["first", "complete"],
          ["third", "next"],
          ["third", "complete"],
          ["empty", "complete"],
          ["drained", "next"],
          ["drained", "next"],
          ["drained", "complete"],
          ["failing", "next"],
          ["joined", "next"],
          ["failing", "complete"],
          ["joined", "next"],
          ["joined", "complete"]
        ]
      }
    },
    "calls": [
      "first",
      "second",
      "third",
      "first",
      "third",
      "third",
      "drained",
      "drained",
      "failing",
      "joined",
      "joined"
    ]
  },
  "matched": true
}
```

### 08-plain-thenable-combinators

Original: `out/safejs-audit-2026-08-27/async-workflows/examples/08-plain-thenable-combinators.js`\
SHA-256: `1c9a14b8bccfd9e9fb00e5a855d17391f585c05c4ec194611a97745a3b84e3ab`

```json
{
  "expected": {
    "id": "08-plain-thenable-combinators",
    "execution": {
      "ok": true,
      "returnValue": {
        "winnerIdentity": [true, true, true],
        "settled": [
          ["fulfilled", true],
          ["fulfilled", true],
          ["rejected", true]
        ],
        "rejectionIdentity": true,
        "aggregate": { "name": "AggregateError", "count": 2, "first": true, "second": true },
        "empty": [[], []],
        "trace": [
          ["caller"],
          ["assimilate", "slow"],
          ["assimilate", "fast"],
          ["settle", "fast"],
          ["assimilate", "rejected"],
          ["settle", "rejected"],
          ["settle", "slow"],
          ["assimilate", "all-error"],
          ["settle", "all-error"],
          ["assimilate", "any-first"],
          ["assimilate", "any-second"],
          ["settle", "any-second"],
          ["settle", "any-first"]
        ]
      }
    },
    "calls": []
  },
  "actual": {
    "id": "08-plain-thenable-combinators",
    "execution": {
      "ok": true,
      "returnValue": {
        "winnerIdentity": [true, true, true],
        "settled": [
          ["fulfilled", true],
          ["fulfilled", true],
          ["rejected", true]
        ],
        "rejectionIdentity": true,
        "aggregate": { "name": "AggregateError", "count": 2, "first": true, "second": true },
        "empty": [[], []],
        "trace": [
          ["caller"],
          ["assimilate", "slow"],
          ["assimilate", "fast"],
          ["settle", "fast"],
          ["assimilate", "rejected"],
          ["settle", "rejected"],
          ["settle", "slow"],
          ["assimilate", "all-error"],
          ["settle", "all-error"],
          ["assimilate", "any-first"],
          ["assimilate", "any-second"],
          ["settle", "any-second"],
          ["settle", "any-first"]
        ]
      }
    },
    "calls": []
  },
  "matched": true
}
```

### 09-rejection-identity-matrix

Original: `out/safejs-audit-2026-08-27/async-workflows/reductions/09-rejection-identity-matrix.js`\
SHA-256: `a2831685cdf96c2c904126c28483a5bbc8453715df789316d7aba8cd92a1255f`

```json
{
  "expected": {
    "id": "09-rejection-identity-matrix",
    "execution": {
      "ok": true,
      "returnValue": [
        ["direct-throw", true],
        ["function-throw", true],
        ["await-reject", true],
        ["async-immediate", true],
        ["async-delayed", true],
        ["await-thenable", true],
        ["promise-catch", true],
        ["allSettled-reason", true],
        ["catch-return-value", true],
        ["array-rejection", true],
        ["error-rejection", true]
      ]
    },
    "calls": []
  },
  "actual": {
    "id": "09-rejection-identity-matrix",
    "execution": {
      "ok": true,
      "returnValue": [
        ["direct-throw", true],
        ["function-throw", true],
        ["await-reject", true],
        ["async-immediate", true],
        ["async-delayed", true],
        ["await-thenable", true],
        ["promise-catch", true],
        ["allSettled-reason", true],
        ["catch-return-value", true],
        ["array-rejection", true],
        ["error-rejection", true]
      ]
    },
    "calls": []
  },
  "matched": true
}
```

### 10-recovery-annotation

Original: `out/safejs-audit-2026-08-27/async-workflows/reductions/10-recovery-annotation.js`\
SHA-256: `892a23449b717778dddc9953ac304496c072268bb1c7cc6d8c0895d1ae432da1`

```json
{
  "expected": {
    "id": "10-recovery-annotation",
    "execution": {
      "ok": true,
      "returnValue": {
        "sameReason": true,
        "sameAnnotations": true,
        "original": { "attempt": 1, "annotations": ["recovered"] },
        "caught": { "attempt": 1, "annotations": ["recovered"] },
        "nextAttempt": 2
      }
    },
    "calls": []
  },
  "actual": {
    "id": "10-recovery-annotation",
    "execution": {
      "ok": true,
      "returnValue": {
        "sameReason": true,
        "sameAnnotations": true,
        "original": { "attempt": 1, "annotations": ["recovered"] },
        "caught": { "attempt": 1, "annotations": ["recovered"] },
        "nextAttempt": 2
      }
    },
    "calls": []
  },
  "matched": true
}
```

### 11-waterfall-error-instance

Original: `out/safejs-audit-2026-08-27/async-workflows/rewrites/11-waterfall-error-instance.js`\
SHA-256: `fb22a8bc4b514f0b82ca889c5fd34a1d4cfd0160573984328792a4bc5610b891`

```json
{
  "expected": {
    "id": "11-waterfall-error-instance",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": [true, true, true],
        "caughtIdentity": true,
        "shared": { "name": "ledger", "entries": [2, 5, 11], "total": 10 },
        "trace": [
          ["stage", 0],
          ["stage", 1],
          ["identity", true, true, true, true],
          ["stage", 2],
          ["stage", 3],
          ["stage", 0],
          ["stage", 1],
          ["closed", 10]
        ]
      }
    },
    "calls": ["waterfall:load", "waterfall:commit", "waterfall:fail"]
  },
  "actual": {
    "id": "11-waterfall-error-instance",
    "execution": {
      "ok": true,
      "returnValue": {
        "success": [true, true, true],
        "caughtIdentity": true,
        "shared": { "name": "ledger", "entries": [2, 5, 11], "total": 10 },
        "trace": [
          ["stage", 0],
          ["stage", 1],
          ["identity", true, true, true, true],
          ["stage", 2],
          ["stage", 3],
          ["stage", 0],
          ["stage", 1],
          ["closed", 10]
        ]
      }
    },
    "calls": ["waterfall:load", "waterfall:commit", "waterfall:fail"]
  },
  "matched": true
}
```

### 12-finally-domain-records

Original: `out/safejs-audit-2026-08-27/async-workflows/rewrites/12-finally-domain-records.js`\
SHA-256: `4ab166ed50bce8a58d3ecbd41b30bd374b11112a29a08fca801d68bcc01535aa`

```json
{
  "expected": {
    "id": "12-finally-domain-records",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "name": "success", "value": "body-value", "original": true, "overridden": false },
          {
            "name": "body",
            "error": "body",
            "body": true,
            "inner": false,
            "outer": false,
            "chain": false
          },
          {
            "name": "inner",
            "error": "inner-cleanup",
            "body": false,
            "inner": true,
            "outer": false,
            "chain": false
          },
          {
            "name": "outer",
            "error": "outer-cleanup",
            "body": false,
            "inner": false,
            "outer": true,
            "chain": false
          },
          { "name": "override", "value": "outer-value", "original": false, "overridden": true },
          {
            "name": "chain",
            "error": "promise-finally",
            "body": false,
            "inner": false,
            "outer": false,
            "chain": true
          }
        ],
        "trace": [
          ["success", "inner-enter"],
          ["body", "inner-enter"],
          ["inner", "inner-enter"],
          ["outer", "inner-enter"],
          ["override", "inner-enter"],
          ["chain", "inner-enter"],
          ["success", "inner-exit"],
          ["success", "outer-enter"],
          ["body", "inner-exit"],
          ["body", "outer-enter"],
          ["inner", "outer-enter"],
          ["outer", "outer-enter"],
          ["override", "outer-enter"],
          ["chain", "inner-exit"],
          ["chain", "outer-enter"],
          ["success", "outer-exit"],
          ["body", "outer-exit"],
          ["inner", "outer-exit"],
          ["outer", "outer-exit"],
          ["override", "outer-exit"],
          ["chain", "outer-exit"],
          ["success", "promise-finally"],
          ["body", "promise-finally"],
          ["inner", "promise-finally"],
          ["outer", "promise-finally"],
          ["override", "promise-finally"],
          ["chain", "promise-finally"]
        ]
      }
    },
    "calls": [
      "success:body",
      "body:body",
      "inner:body",
      "outer:body",
      "override:body",
      "chain:body",
      "success:inner",
      "body:inner",
      "inner:inner",
      "outer:inner",
      "override:inner",
      "chain:inner",
      "success:outer",
      "body:outer",
      "inner:outer",
      "outer:outer",
      "override:outer",
      "chain:outer",
      "success:promise-finally",
      "body:promise-finally",
      "inner:promise-finally",
      "outer:promise-finally",
      "override:promise-finally",
      "chain:promise-finally"
    ]
  },
  "actual": {
    "id": "12-finally-domain-records",
    "execution": {
      "ok": true,
      "returnValue": {
        "results": [
          { "name": "success", "value": "body-value", "original": true, "overridden": false },
          {
            "name": "body",
            "error": "body",
            "body": true,
            "inner": false,
            "outer": false,
            "chain": false
          },
          {
            "name": "inner",
            "error": "inner-cleanup",
            "body": false,
            "inner": true,
            "outer": false,
            "chain": false
          },
          {
            "name": "outer",
            "error": "outer-cleanup",
            "body": false,
            "inner": false,
            "outer": true,
            "chain": false
          },
          { "name": "override", "value": "outer-value", "original": false, "overridden": true },
          {
            "name": "chain",
            "error": "promise-finally",
            "body": false,
            "inner": false,
            "outer": false,
            "chain": true
          }
        ],
        "trace": [
          ["success", "inner-enter"],
          ["body", "inner-enter"],
          ["inner", "inner-enter"],
          ["outer", "inner-enter"],
          ["override", "inner-enter"],
          ["chain", "inner-enter"],
          ["success", "inner-exit"],
          ["success", "outer-enter"],
          ["body", "inner-exit"],
          ["body", "outer-enter"],
          ["inner", "outer-enter"],
          ["outer", "outer-enter"],
          ["override", "outer-enter"],
          ["chain", "inner-exit"],
          ["chain", "outer-enter"],
          ["success", "outer-exit"],
          ["body", "outer-exit"],
          ["inner", "outer-exit"],
          ["outer", "outer-exit"],
          ["override", "outer-exit"],
          ["chain", "outer-exit"],
          ["success", "promise-finally"],
          ["body", "promise-finally"],
          ["inner", "promise-finally"],
          ["outer", "promise-finally"],
          ["override", "promise-finally"],
          ["chain", "promise-finally"]
        ]
      }
    },
    "calls": [
      "success:body",
      "body:body",
      "inner:body",
      "outer:body",
      "override:body",
      "chain:body",
      "success:inner",
      "body:inner",
      "inner:inner",
      "outer:inner",
      "override:inner",
      "chain:inner",
      "success:outer",
      "body:outer",
      "inner:outer",
      "outer:outer",
      "override:outer",
      "chain:outer",
      "success:promise-finally",
      "body:promise-finally",
      "inner:promise-finally",
      "outer:promise-finally",
      "override:promise-finally",
      "chain:promise-finally"
    ]
  },
  "matched": true
}
```

### 13-domain-error-metadata

Original: `out/safejs-audit-2026-08-27/async-workflows/reductions/13-domain-error-metadata.js`\
SHA-256: `f1fb10e7e5a568a3041c843ae8a19190805cc1b3d53fa2ed550c2de6fa816e03`

```json
{
  "expected": {
    "id": "13-domain-error-metadata",
    "execution": {
      "ok": true,
      "returnValue": {
        "plain": {
          "same": true,
          "name": "DomainFailure",
          "message": "try again",
          "code": "RETRY",
          "retryable": true,
          "context": { "job": "alpha" },
          "contextSame": true
        },
        "allocated": {
          "same": true,
          "name": "Error",
          "message": "try again",
          "code": "RETRY",
          "retryable": true,
          "context": { "job": "alpha" },
          "contextSame": true
        },
        "catchContinuationSame": true
      }
    },
    "calls": []
  },
  "actual": {
    "id": "13-domain-error-metadata",
    "execution": {
      "ok": true,
      "returnValue": {
        "plain": {
          "same": true,
          "name": "DomainFailure",
          "message": "try again",
          "code": "RETRY",
          "retryable": true,
          "context": { "job": "alpha" },
          "contextSame": true
        },
        "allocated": {
          "same": true,
          "name": "Error",
          "message": "try again",
          "code": "RETRY",
          "retryable": true,
          "context": { "job": "alpha" },
          "contextSame": true
        },
        "catchContinuationSame": true
      }
    },
    "calls": []
  },
  "matched": true
}
```
