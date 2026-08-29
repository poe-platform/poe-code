# O12 modern negative-oracle repair: independent validation

Date: August 29, 2026. Independent reviewer; Planck owns the author repair.

## Frozen scope

Candidate manifest SHA-256: `9418491ccbcf03d2fb0c6695549d245559dd6edee8535c94b5d2006700e4734f`. Prior adjudication SHA-256: `0cfc3025ef3708f8308c17aafde9b15de9889232c46e2d860efdcaef736b2cf3`. The seven author publication files remain byte-exact; this review is the eighth unique publication path. The 100 prerequisites are separate and are not O12-owned production changes.

Fresh main clone was pulled before staging: `b06e79ab841765f06d0a577230f10db28f98c457`. The clean Git-tree projection has no ignored `out` support directory and uses its own pinned dependency install and standard public build. No original audit payload, README edit, skill sync, commit, push, custom bundle, private export injection, or forged receipt is involved.

## Independent progress record

- Standard root build succeeded; all 260 captured public-build files match Planck's hashes.
- Unchanged Curie test: source 6 pass / 2 fail; built 6 pass / 2 fail. Both historical synthesized-false identity failures are preserved in full command receipts.
- Exact Planck test: source 8 pass / 0 fail; built 8 pass / 0 fail. No runtime or generated-bundle bytes changed between RED and GREEN.
- Default full-root, types/lint/format, full typed receipt review, and final signoff follow below after actual execution. This progress record is not a publication approval.

No Map/HOST closure, release-smoke approval, npm publication status, or final published all-stack completion is claimed.

## Final independent verdict — August 29, 2026

**READY for bounded O12 root/publisher intake.** No O12 blocker was found. This is independent validation of Planck’s exact frozen repair, not authorization to publish, a source fix, or final all-stack closure. The progress record above and all historical/current RED receipts remain intact.

The repair follows adjudication `0cfc3025ef3708f8308c17aafde9b15de9889232c46e2d860efdcaef736b2cf3`: remove only the two assignments synthesizing false rejection identities and use the unchanged complete native return. The additional assertions tighten the negative: delete only Error tag and stack from a clone of the entire captured journal, require literal minimal-graph equality, then require whole-journal equality. No other expected value, case, fixture, public child program, or production source changes.

The seven author publication files comprise two changed/new repair files (test and author plan) and five unchanged inherited files. This review makes **eight unique publication paths**. Six ordered preimages are present; the author plan and this review are absent. All eight are absent at base HEAD. An absent base preimage never authorizes overwriting a later publisher file.

## Reproduction and safety

- Worktree: `/Users/kjopek/Workspace/poe-code-safejs-o12-final-independent-review`.
- Clean projection: `.tmp/o12-clean-publication`, made from the pulled main Git tree plus 100 explicitly enumerated frozen prerequisites, seven author paths, and this eighth review. No ignored support/evidence tree was copied. Its `out/` directory is absent before and after validation.
- Own dependency install and normal root build; package resolution remains inside the clean projection. Source mode uses the unchanged test’s public-export-only in-memory compilation. Built mode imports the normal `@poe-code/safejs` package: no instrumented bundle, private export, forged brand/receipt, metadata injection, or bridge modification.
- Inspected hash-bound workflow and inline programs before native execution. The O12 guest receives bounded JSON, promises, and in-memory mocked boundary callbacks; no guest filesystem/network/LLM capability. Host fixture reads, child stdin/stdout, builds, and evidence storage are separate. The requested whole-root suite includes its existing host integration IO; it is not claimed entirely IO-free.
- No original audit payload read, recursive audit search, excluded/security read, other-clone write, README edit, sync, branch, commit, or push. Earlier provenance limitations are not reclassified by this validation.
- TERM is unset for execution gates; HOME/npm cache is isolated under owned evidence and no API credentials are passed. No timeout, exclusion, Vitest configuration, assertion, or package configuration was relaxed. Full-run reporter flags affect reporting only.

## Actual command results

Commands run from the clean projection unless noted. Exact argv, timestamps, environment, status, stdout/stderr, and supplemental typed stdin are frozen in evidence. Binary output uses V8/base64; large text uses lossless gzip/base64 with original byte counts and SHA-256.

| Command                                                                                                                                              | Independent result                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| `env -u TERM npm ci --ignore-scripts --no-audit --no-fund`                                                                                           | Exit 0; 548 packages. Warnings retained; no upgrade/audit intervention.                                                        |
| `env -u TERM npm run build`                                                                                                                          | Exit 0; 67 successful tasks, 0 cached; normal public build.                                                                    |
| `env -u TERM SAFEJS_O12_API=source ./node_modules/.bin/vitest run --config packages/safejs/test/input-error-projection.vitest.config.ts`, frozen RED | Exit 1; 6 passed, 2 failed.                                                                                                    |
| Same command with `SAFEJS_O12_API=built`, frozen RED                                                                                                 | Exit 1; 6 passed, 2 failed.                                                                                                    |
| Same source command, exact frozen GREEN                                                                                                              | Exit 0; 8 passed.                                                                                                              |
| Same built command, exact frozen GREEN                                                                                                               | Exit 0; 8 passed.                                                                                                              |
| `env -u TERM ./node_modules/.bin/vitest run --reporter=default --reporter=json`                                                                      | Exit 0; **25,860 passed, 41 skipped, 0 failed**; 994 files passed, 3 skipped; 266.94 seconds; default full-root configuration. |
| `env -u TERM npm run lint`                                                                                                                           | Exit 0; configured ESLint, build TypeScript check and workflow lint.                                                           |
| `env -u TERM npm run lint:packages`                                                                                                                  | Exit 0; 17 rules across 68 packages.                                                                                           |
| `env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`                                                                      | Exit 0.                                                                                                                        |
| `env -u TERM ./node_modules/.bin/tsc -p packages/safejs/test/final-async-proof.tsconfig.json`                                                        | Exit 0.                                                                                                                        |
| Strict introduced-test tsc, exact 38 roots/flags in `evidence/type-scopes.json`                                                                      | Exit 0; zero diagnostics.                                                                                                      |
| `env -u TERM ./node_modules/.bin/prettier --check` plus explicit supported path list                                                                 | Exit 0; 103 paths; five unchanged format exceptions recorded.                                                                  |
| `git diff --no-index --check -- /dev/null <path>` for all 108 composite paths                                                                        | Zero whitespace diagnostics; raw exit 1 means differences from empty, not a whitespace error.                                  |
| `git diff --check` in actual main clone                                                                                                              | Exit 0; no tracked edits.                                                                                                      |

Only these focused RED selectors fail:

- `O12 exact modeled Error proof projection > classifies minimal proof 1 against the same capture and request`
- `O12 exact modeled Error proof projection > classifies minimal proof 2 against the same capture and request`

Historical standard-bundle **8/8** remains historical evidence, not a fresh rerun or reinterpreted modern result. All 44 files in the earlier immutable adjudication capsule match its manifest and remain read-only, including original bundle/test/receipts. Modern unchanged **6/8** remains RED. Only the exact reviewed oracle gives modern **8/8**. AST extraction confirms identical RED/GREEN public child code, SHA-256 `c7af95cefdbce66a7c8f389b86fb52950cb74e33181f2689bd747be5d1348f34`, and case definitions. Three projections times two repeats plus capture/raw qualification remain eight cases.

## Full native, typed graphs, and journals

Three NEW native controls pass: actual captured native Error and the two actual minimal proof reasons, bound to the same fresh built capture and pending request. The inline native procedure is byte-identical to the prior adjudication. It checks the unchanged complete return, calls, host trace, acknowledgements, and repeated rejection identity. Actual Error is an Error; minimal reasons are plain name/message objects. Both native identity observations are true in all three controls.

Independently decoded and compared all 52 focused V8 envelopes and 14 O12 envelopes from the default full run. Every returned field is compared. Request/proof identities bind to the saved capture; callbacks are zero. Genuine completed receipt recovery performs no calls/requests and preserves modeled reason aliases. All five journal rows are consumed. Initial inputs and existing settlement prefixes remain exact. Fresh-process completed replays perform zero calls/requests and preserve complete replay and promiseReplay journals.

| Projection                                        | Required and actual complete outcome                                                                                                                                                                                              |
| ------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Complete modeled proof, both repeats/source/built | `modeledReasonIdentity=true`; reason equals recovered reason and nested aliases; `errorType="Error"`; modeled stack exactly `Error: right input unavailable`; encoded outcome and entire five-row journal equal capture.          |
| Minimal proof, both repeats/source/built          | Native identities both true; `modeledReasonIdentity=false`; not recovered reason; own names exactly name/message, no own stack; no encoded tag/stack. Whole journal differs only at the two loss paths below.                     |
| Native-fields control, both repeats               | Native identities true; `modeledReasonIdentity=false`; reason equals captured native-fields projection. Keeps actual native stack but lacks modeled Error tag; only tag and stack value differ. Not a complete typed Error proof. |
| Raw public Error qualification                    | Unchanged expected unsupported-input error remains separate, not substituted for O12, not converted to success, not claimed fixed.                                                                                                |

Exact minimal loss paths, with no other journal differences:

- `$.calls[0].outcome.data.nodes[0].errorType`
- `$.calls[0].outcome.data.nodes[0].properties.stack`

Expected and actual minimal encoded graph:

```json
{
  "root": {
    "tag": "ref",
    "id": 0
  },
  "nodes": [
    {
      "kind": "object",
      "nullPrototype": true,
      "extensible": true,
      "properties": {
        "name": {
          "value": "Error",
          "configurable": true,
          "enumerable": true,
          "writable": true
        },
        "message": {
          "value": "right input unavailable",
          "configurable": true,
          "enumerable": true,
          "writable": true
        }
      }
    }
  ]
}
```

Two NEW H5 context-converted complete proofs and two fresh-process completed replays also pass on the current normal built public package. The exact frozen context child uses `context.toSandboxValue({ reason: model.actualError, again: model.actualError, nested: { reason: model.actualError } })`; callbacks and replayed callbacks are empty. Each retains aliases, exact modeled tag/stack, entire captured journal, and complete native result. No private converter, forged SandboxValue metadata, or custom built bundle.

The complete 17-row native trace, promise/emission aliases, closure/mutation/order outcomes, numeric/empty-input outcomes, and every other returned field are equal:

```json
{
  "balance": 10,
  "names": ["fallback:0", "open:0", "credit:1"],
  "promiseAliases": [true, true, true, true, true],
  "inputOutcomes": [
    {
      "key": "right",
      "status": "rejected",
      "same": true,
      "name": "Error",
      "message": "right input unavailable"
    },
    {
      "key": "left",
      "status": "fulfilled",
      "same": true,
      "batch": "left"
    }
  ],
  "closure": {
    "initialBalance": 0,
    "currentBalance": 10,
    "processed": ["right", "left"]
  },
  "emissionAliases": [true, true],
  "emissionBalances": [10, 10, 10],
  "initialIsFirst": false,
  "lastIsCurrent": true,
  "numeric": [16],
  "numericIndexes": [1, 2],
  "empty": [[19], [], false],
  "trace": [
    ["boundary", "both-pending"],
    ["await", "right"],
    ["rejected", "right", "Error", "right input unavailable", true],
    ["event", "right", "fallback", 2],
    ["closed", "right", 1, true],
    ["closure", "right", 0, 2, 1],
    ["boundary", "after:right"],
    ["await", "left"],
    ["fulfilled", "left", "left", true],
    ["event", "left", "open", 5],
    ["event", "left", "credit", 10],
    ["closed", "left", 2, true],
    ["closure", "left", 0, 10, 2],
    ["boundary", "after:left"],
    ["closed", "numeric", 3, false],
    ["closed", "empty-seeded", 0, false],
    ["closed", "empty-unseeded", 0, false]
  ]
}
```

Complete five-row journals, saved/completed snapshots, requests, proof/reason graphs, host traces, acknowledgements, and typed alias-bearing envelopes are in `evidence/full-outcomes.json` and command receipts. These are new captures on this composition, not invented historical generations.

## Prerequisites and integrity

- curie: `5080142b0411bd0f27381271451b7caaa724620f0ac30fcd254f372aede86220`.
- laplace: `0cfc3025ef3708f8308c17aafde9b15de9889232c46e2d860efdcaef736b2cf3`.
- ppr2: `31d14e25974bf910ec253539458085d903d1c38a6ccd3551b2f4992b1dd136b0`.
- ppr1: `cabdebcc481a7371d373000c4990a9bc36c233808f796b692dff76ed1fe9d94b`.
- h5: `6f58c7ec1dbcd579f9132be1819290bb47d046e75ae7ed6c25249b870f91ee74`.
- h5-final: `7f35f5565452ca9985b6f7eca3a05f0c0475cbc0e2e0d5e4afe26c023b226d67`.

All 100 effective prerequisite files match frozen bytes. Their 25 differences from main are separate from O12 ownership. The three prerequisite production differences are host-bridge, host-call, and values, not reviewer-authored changes. Final PPR2 production and PPR1 values match. H5 legitimately supersedes PPR1 host-bridge: H5 ordered preimage equals PPR1 postimage. Final H5 production equals unchanged H5 author production. Newer main interpreter is preserved. Effective hashes and ownership/order are in `evidence/integrity.json`.

All 386 recorded production/public-build files (127 source and 259 built) match author before hashes and remain unchanged through RED/GREEN, native/context controls, and full validation. The separate 260-file public-package inventory consists of those 259 built files plus the package descriptor. Main package/lock/Vitest/build-TypeScript and SafeJS package/type configurations match pulled base. Entire source fixture and expectations file are byte-exact. No runtime dependency on `out` is introduced.

## Qualified expanded type scope

Configured checks and introduced 38-root strict types are clean. The expanded 42-root comparison is **qualified RED, not a passing type gate**: frozen RED and GREEN each produce the same 56 diagnostics. All signatures also match Planck’s captured signatures; no new diagnostic is hidden.

- `packages/safejs/src/interp/methods/function.test.ts`: 9.
- `packages/safejs/src/run.references.test.ts`: 2.
- `packages/safejs/src/runner/signal-dump.test.ts`: 16.
- `packages/safejs/src/snapshot/restore.test.ts`: 29.

Baseline compiler host substitutes only exact RED test bytes in memory; candidate reads exact GREEN. Cwd, flags, roots, signatures and source hashes are explicit in evidence. Comparison exit 0 means identical diagnostics, not zero errors. Nothing unrelated was patched.

## Publication payload and application rules

| Publication path                                                               | SHA-256                                                            |                Bytes |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------ | -------------------: |
| `docs/plans/safejs-final-o12-validation.md`                                    | `a57fad0c36997d24e0728e8739b3fbe95a807ce754f4d9fd857e2e64890bd623` |                29123 |
| `docs/plans/safejs-fix-o12-negative-oracle.md`                                 | `49f7ad2ba3f582063b497d9f59031db93974f111c41f1c58f183e0b7246271bd` |                13400 |
| `docs/plans/safejs-o12-negative-oracle-adjudication.md`                        | `b61ce7f878e27a5aebce3917a42ad42e27679935e2e92af7c0b647c79e3f7671` |                26923 |
| `packages/safejs/test/fixtures/input-error-projection/01-input-batch-scan.ajs` | `8344978a75b367325409f07193a28977225c5c833a65e5a14537f2fd9b5cb005` |                 3937 |
| `packages/safejs/test/fixtures/input-error-projection/expectations.fixture`    | `00513a4fddf25e46365c7cd51e981fda86b785f3fdedf8cf85983e6cdc56505c` |                11720 |
| `packages/safejs/test/input-error-projection.vitest.config.ts`                 | `8757dabecad22b8ec6c4900bf858c26fb815f63706df92a4dfe35ea482c08d29` |                  268 |
| `packages/safejs/test/integration/input-error-projection.test.ts`              | `1d84134fbed72fb7be6eabbab331d22d59ab3641cf05966b29b826e9a92a61e4` |                22786 |
| `docs/plans/safejs-validate-o12-negative-oracle-repair.md`                     | Recorded in candidate manifest; no self-referential report hash    | Recorded in manifest |

Freeze: `out/safejs-remediation/o12-final-independent-review/candidate/manifest.json`. Exactly eight publication payloads under `files/`; six exact ordered preimages under `ordered-preimages/`; two absent ordered states; eight absent base states at `b06e79ab841765f06d0a577230f10db28f98c457`. Inputs, prerequisite identities, command evidence and historical hashes are not publication payloads. Captured bytes must equal validated bytes before sealing; external seal verification records manifest and report hashes.

Publisher must use captured bytes, check exact current preimages, and explicitly resolve later composition rather than overwrite it. Separate prerequisite approvals/root intake remain required. Fresh publisher DEFAULT full/build/types/lint/format/diff on final actual main is mandatory. Curie’s PPR2 stale CI smoke repair is outside this review. No Map/HOST closure, npm release beyond 11.0.24, final published PPR1/PPR2/H5 all-stack approval, or permission to publish is implied.
