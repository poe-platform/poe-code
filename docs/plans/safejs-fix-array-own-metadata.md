# SafeJS ARRAY-OWN-METADATA candidate fix

## Call-order repair status

Updated 2026-08-28T23:40:30-0500: Noether's historical **NOT READY** verdict and all validator assertions/evidence remain unchanged. The five call-order blockers now pass author verification after a generic call-evaluation repair; **fresh independent validation is still required**. Checkpoint custom-metadata/raw loss and regex metadata own-key ordering remain **PENDING dedicated followups**. STR-03 has a separately validated candidate queued for publication, not integrated into this clone. Whole-fixture qualifications remain in force. The initial candidate report below is historical; the appended repair section supplies current hashes and results.

Observed: 2026-08-28T23:07:26-0500. Status: candidate ready for independent validation; not published. This document does not mark the root remediation goal complete.

## Isolation and ownership

- Workspace: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata`, independently cloned from `https://github.com/poe-platform/poe-code.git` with `--single-branch --branch main`.
- Before work: `git -c pull.rebase=false pull --ff-only` reported already up to date; worktree was clean.
- Branch: `main`; base and final HEAD: `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`.
- Read ancestor `/Users/kjopek/Workspace/AGENTS.md` and clone-root `AGENTS.md`; no nested AGENTS files were present in the clone.
- Only the five code/test files fingerprinted below and this plan are owned. No original-repository changes, shared-fix-workspace writes, cross-workspace file copying, branches, commits, pushes, stash, reset, staging, README edits, inline comments, dependency changes, or executable QA artifacts.
- The shared setup report was read only. Integration with concurrent interpreter changes is for the publisher, serially by hunk, followed by independent revalidation.

## Archive guard and evidence boundary

The original audit is read-only at `/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27`.
Before reading report/case payloads, loaded only `inventory-verification.json` metadata and asserted exactly 38 entries at `checks.artifacts.excludedPaths`. All 38 paths and the entire `security/` directory are denied before file reads. Metadata SHA-256: `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`.

Archive discovery used directory-name metadata and inventory metadata, not recursive payload searches. No rg/glob content search traversed the audit or a family. Every report and case read used an explicit path checked by the guard. No excluded payload was read, displayed, copied, hashed, or executed. Two guessed paths were absent (dynamic-programming directory and data-pipelines-review/REVIEW.md); no payload was read from those paths. The actual corroborating review is data-pipelines-review/REPORT.md.

Explicit nonexcluded payload/metadata paths read, in addition to exclusion-bootstrap metadata:

- `REPORT.md`
- `strings/REPORT.md`
- `numerics/REPORT.md`
- `numerics-review/REVIEW.md`
- `inventory.json`
- `strings/results.json`
- `strings/reductions/r01-match-metadata.safejs`
- `data-pipelines/REPORT.md`
- `strings/examples/04-semver-coerce-sort.safejs`
- `strings/examples/06-template-replacement-unicode.safejs`
- `strings/examples/07-mustache-scanner-offset.safejs`
- `numerics/09-histogram-object-configuration.ajs`
- `data-pipelines/lcs-array-diff.ajs`
- `data-pipelines-review/REPORT.md`
- `data-pipelines/cases.json`
- `strings/reductions/r02-semver-overlap-progress.safejs`
- `numerics/13-array-metadata-reduction.ajs`
- `data-pipelines/expected.json`
- `numerics/final-cases.json`
- `numerics/followup-native-reference.json`

The report assigns P1 ARRAY-OWN-METADATA to STR-01 and NUM-002; DP-2 independently corroborates the same own-array-property reader. No security probes, new attack fixtures, real LLM calls, guest network/filesystem/process access, or new host capabilities were introduced. New unit tests create no files. Broad verification is restricted to ordinary interpreter/method/reference semantics; security/prototype-focused cases are excluded.

## Candidate patch

1. In `getArrayMember`, preserve the existing canonical-index and special-length handling, then return an own property before looking up intercepted methods. Use `Object.hasOwn`, not truthiness or an inherited property lookup: false, zero, empty string, null, undefined, references, callbacks, and non-index numeric names retain their own semantics.
2. Array method-call fast paths apply only when the array does not own the requested key. Own members use the existing ordinary member-call machinery, retaining the receiver, optional-call behavior, and native shadowing of built-in names. Deleting a shadow restores the built-in method.
3. The synthetic tagged-template `raw` path applies only to registered tagged-template arrays, so ordinary arrays can read their own `raw` metadata.
4. Add native-first regressions in `run.array-own-metadata.test.ts`; update two existing expectations that explicitly asserted own metadata was unreadable. Existing inherited-property fixtures and assertions are unchanged. Those two mixed own/inherited tests are not executed in this restricted task; the new ordinary-array regressions exercise the changed own-property behavior.

No regex replacement logic, match-result property insertion order, collection implementation, provider, or host module is changed.

## TDD and checks actually executed

Setup:

- `SKIP_SYNC_SKILLS=1 npm ci`: exit 0; 548 packages added, 619 audited; lockfile unchanged. npm reported 10 vulnerabilities and the existing glob deprecation warning; no audit fix or dependency upgrade attempted.
- `./node_modules/.bin/turbo run build --filter=@poe-code/agent-spawn --filter=@poe-code/frontmatter --filter=tiny-mcp-client --output-logs=errors-only`: exit 0, 21/21 tasks successful.

Focused command:

`./node_modules/.bin/vitest run packages/safejs/src/run.array-own-metadata.test.ts --reporter=verbose`

- First RED: 11/11 fail, exit 1. Ordinary bounds enumerate and pass Object.hasOwn, but x0/x1 reads are undefined; matcher invocation rejects; raw and non-index numeric fields disappear; regex index/input are undefined; own method shadowing fails.
- Sorted only the regression's regex key-membership assertion to avoid conflating the independent baseline insertion-order difference with metadata readability. Reran RED: still 11/11 fail, exit 1.
- Initial reader/dispatch fix: 11/11 pass, exit 0.
- Added native receiver and optional-own-undefined-call checks before the additional dispatch change: 2 fail and 10 pass, exit 1. Failures were `Cannot read properties of null or undefined.` and `Array#map is not a supported method.`.
- Routed owned array calls through existing ordinary dispatch: 12/12 pass. Final run after the test type-narrowing cleanup: 12/12 pass, 935 ms, exit 0.

Final broader command:

`./node_modules/.bin/vitest run packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/run.references.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/methods --testNamePattern='^(?!.*(?:exposes intercepted array members|does not expose prototypes|dangerous array properties|does not expose host prototypes|__proto__|inherited|spreads only an object)).*$' --reporter=dot`

Result: **8 files passed; 642 tests passed; 9 deliberately skipped; 2.49 seconds; exit 0**. An earlier run of the original 11-test regression version passed 642 tests with 8 skipped; the final conservative filter also excludes the existing ordinary own-enumerable-object spread control. This is not a claim that the full adversarial or entire-repository suite ran.

Type/lint/format checks:

- `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: PASS, exit 0.
- `./node_modules/.bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/interp/methods/array.test.ts`: PASS, exit 0.
- An additional strict command including `packages/safejs/src/interp/interpreter.test.ts` failed. After fixing the new test's two result-union access errors, the remaining **154 diagnostics** are exclusively in the existing interpreter test file. A TypeScript compiler-host comparison against `git show HEAD:<file>` contents substituted entirely in memory produced an exactly identical diagnostic list for base and candidate. Examples: missing parseModule export at line 3; ParseResult versus Statement at line 18; optional InterpretOptions snapshot access at line 23. These unrelated baseline test typing defects are disclosed, not fixed.
- Diagnostic-list SHA-256 for both base and candidate: `15e920951d14e6eec0a6c21e2530174b913699f4db54c16673c852d4dded889e`.
- ESLint on all five changed code/test paths: PASS, exit 0.
- Prettier check on those five paths: PASS, exit 0. Initial formatting-only warning was corrected with apply_patch.
- `git diff --check`: PASS, exit 0.
- No visual CLI output changed; screenshots are not applicable. No full repository build, release, adversarial suite, or external service invocation was run.

## Original workflow protocol and full anchors

Eight unmodified source files supply ten original cases. Their bytes were checked again after validation and are unchanged. Original source was never rewritten into a compatibility implementation.

1. Use the explicit allowlist below, checking the 38 exclusions and security-directory denial first; do not recursively search the archive.
2. Establish all native references before any SafeJS execution of the original workflows. A fresh Node child uses a bounded VM function wrapper for top-level-return sources and imports the exact export-default source bytes as an in-memory data URL for native module cases. Native expected results were checked against original saved full STR/LCS references and independently specified complete histogram bins/configuration.
3. SafeJS is imported from this clone's source through `node --max-old-space-size=192 --import tsx --input-type=module`. Use `modules: {}`, no host function bindings, and only the LCS caseName scalar binding. Export-default numeric sources require `entryPointArgs: []`; an initial harness attempt omitted it and evaluated only module declarations, so that attempt was rejected and rerun before the fix. No empty module-evaluation result counts as a histogram test.
4. STR and numeric bounds: maxSteps 150000, maxCallDepth 48, stringLength 32768, arrayLength 4096, dataSize 2097152, deadline 2500 ms. LCS: maxSteps 300000, maxCallDepth 96, stringLength 131072, arrayLength 2048, dataSize 524288, deadline 3000 ms. Native VM timeout 1500 ms; child heap 192 MiB; native child timeout 10000 ms and SafeJS ten-case child timeout 20000 ms. No limits were raised to make a case pass.
5. Capture baseline before production edits, then run the final candidate twice in fresh child processes. Both final complete outputs and step counts match exactly. Compare full outputs; retain every unrelated difference instead of claiming blanket parity.

Required anchors now pass:

- Semver original: complete coercions, precedence order and parsed outputs match native; returns in 10834 steps instead of baseline step-limit failure at 150001.
- Unicode template original: full token offsets are **[2,13]** and **[0,9,18]**. All metadata and nonreplacement fields match native. Six replacement-output leaves remain different, exactly unchanged from baseline STR-03; see full diff below.
- Mustache original: complete nested token output matches native; consumed lengths **[67,34,19,11]**, all remaining strings empty, 2999 steps.
- Histogram original: complete 13 bins, all 26 numeric bounds, all member IDs, original/input-change/narrow-domain results and configuration getters match native, 3904 steps. Full original bounds: [0,2.5], [2.5,5], [5,7.5], [7.5,10], [10,10], repeated for input-change; narrow bounds [2.5,5], [5,7.5], [7.5,7.5].
- LCS records: left [1,2,4], right [0,1,4], IDs b/c/e; five exact ordered edits and final rows; matches and originalUnchanged true, 2223 steps.
- LCS duplicates: left [1,2,3,4], right [0,1,3,4], IDs b/c/b/e; four exact ordered edits and final rows; both booleans true, 2169 steps.
- LCS empty-left: empty LCS plus five exact inserts and final rows; both booleans true, 324 steps.

Independent remaining differences:

- STR-03: unmatched-capture $2, prefix and suffix replacement expansion still differ in six full-output leaves. No replacement code was edited.
- Existing match-result Object.keys insertion order is [0,1,groups,index,input] versus native [0,1,index,input,groups]. The unmodified r01 original therefore still has nine key-order leaf differences despite all three index/input reads being repaired. Baseline and final key arrays are exactly equal; the new regex regression compares sorted key membership rather than falsely asserting this independent insertion-order defect is fixed.
- The extra strict legacy interpreter-test typing check remains non-green as disclosed above.

- 04-semver-coerce-sort.safejs: 10834 steps; 0 remaining full-output leaf differences.
- 06-template-replacement-unicode.safejs: 619 steps; 6 remaining full-output leaf differences.
- 07-mustache-scanner-offset.safejs: 2999 steps; 0 remaining full-output leaf differences.
- r01-match-metadata.safejs: 79 steps; 9 remaining full-output leaf differences.
- r02-semver-overlap-progress.safejs: 196 steps; 0 remaining full-output leaf differences.
- 09-histogram-object-configuration.ajs: 3904 steps; 0 remaining full-output leaf differences.
- 13-array-metadata-reduction.ajs: 36 steps; 0 remaining full-output leaf differences.
- lcs-records: 2223 steps; 0 remaining full-output leaf differences.
- lcs-duplicates: 2169 steps; 0 remaining full-output leaf differences.
- lcs-empty-left: 324 steps; 0 remaining full-output leaf differences.

## Source fingerprints

Paths below are relative to the read-only audit root.

| Original source                                           | SHA-256                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `strings/examples/04-semver-coerce-sort.safejs`           | `ff1600e438e8682d512dc65cb779e411126e23d69d866357b0264914a269fb2e` |
| `strings/examples/06-template-replacement-unicode.safejs` | `d211632dfa16b9865d63699e8d1a4b47bd793f813447854173fd909b2fa2972b` |
| `strings/examples/07-mustache-scanner-offset.safejs`      | `3006f2b0bc665e1850ef1f53634b92769a412cf2d8e07098d2124d93db0caee8` |
| `strings/reductions/r01-match-metadata.safejs`            | `0d5bef1aede138e38a3f8d8367a61f601dc451b0167c2d15590d230009b8f2ce` |
| `strings/reductions/r02-semver-overlap-progress.safejs`   | `73b4e8e6247eda0a895a01b9d37fd9fa3a8fbd27fe0051337ec9e764b69fa507` |
| `numerics/09-histogram-object-configuration.ajs`          | `3af55b084c72f521323a6be857c532aa3ba8b11e22de66aec44c59ccbc146c52` |
| `numerics/13-array-metadata-reduction.ajs`                | `5854f36e074a397c52d3b94e67af91132d3b03e2d9a9297c6a52d57b37c3303e` |
| `data-pipelines/lcs-array-diff.ajs`                       | `f25b19f819e5a60859e49c371733cd856d5cd53d63cb644dcdce4a51c33f289f` |

## Candidate file fingerprints

Paths are relative to this isolated clone. The only additional changed path is `docs/plans/safejs-fix-array-own-metadata.md`; its final hash is supplied in the handoff because a file cannot contain its own final hash.

| Changed code/test file                               | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/interpreter.ts`          | `5f83dd72553c14ad0bae24e5a4a2069859bb1ed48d37a7f56ab5d098d3959796` |
| `packages/safejs/src/interp/interpreter.test.ts`     | `adb1281d5707db96163f9b938f3ee6bff180d1e53ee2aa3574c20c49b6f8df7f` |
| `packages/safejs/src/interp/methods/array.ts`        | `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba` |
| `packages/safejs/src/interp/methods/array.test.ts`   | `5dff8d15e5391378d2258829f1a3a161426d75ed9e8c5f8cedae79d988d7745d` |
| `packages/safejs/src/run.array-own-metadata.test.ts` | `b69b551247c0af31529bfe4ce2623f394e83cc4615373d2495e32f7ad4e2fa37` |

## Independent validation and integration handoff

- Independent validator must check these hashes and base SHA before reviewing; the patch is not yet independently validated.
- Integrate only the listed own-metadata hunks, serially with concurrent interpreter/collection changes. Never copy entire files into the original or shared workspace.
- Re-run the focused/native-first checks and the substantial untouched originals, preserving all full anchors and reporting STR-03, key-order and legacy typing qualifications separately.
- No commit or push is authorized by this candidate. Release monitoring belongs to the later authorized publisher.

## Full original outputs

Each case includes the newly established native result, actual pre-fix result, and final candidate result. The second final run is exactly equal to the first, including steps. Undefined is losslessly tagged as {"$type":"undefined"}; snapshots and internal closures are deliberately not serialized. Numeric result.stats.nodeVisits counts top-level module evaluation; the separately captured steps field is the complete budget count including the invoked default function.

### 04-semver-coerce-sort.safejs

Source: `strings/examples/04-semver-coerce-sort.safejs`; bindings: `{}`.

```json
{
  "native": {
    "coercions": [
      {
        "input": "release v1.2.3.4",
        "ltr": "1.2.3",
        "rtl": "2.3.4"
      },
      {
        "input": "1.2.3/4",
        "ltr": "1.2.3",
        "rtl": "4.0.0"
      },
      {
        "input": "版本 42.6.7.9.3-rc.1",
        "ltr": "42.6.7",
        "rtl": "1.0.0"
      },
      {
        "input": "10000000000000000.4.7.4",
        "ltr": "4.7.4",
        "rtl": "4.7.4"
      },
      {
        "input": "v3.4 replaces v3.3.1",
        "ltr": "3.4.0",
        "rtl": "3.3.1"
      },
      {
        "input": "words only",
        "ltr": null,
        "rtl": null
      },
      {
        "input": 2,
        "ltr": "2.0.0",
        "rtl": "2.0.0"
      },
      {
        "input": null,
        "ltr": null,
        "rtl": null
      }
    ],
    "ordered": [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0"
    ],
    "parsed": [
      {
        "core": [1, 2, 3],
        "prerelease": [],
        "build": "build.7",
        "version": "1.2.3+build.7"
      },
      null,
      null,
      null,
      {
        "core": [1, 2, 3],
        "prerelease": ["rc", "2"],
        "build": "",
        "version": "1.2.3-rc.2"
      }
    ]
  },
  "baseline": {
    "id": "04-semver-coerce-sort.safejs",
    "kind": "throw",
    "name": "SandboxError",
    "message": "Sandbox budget exceeded for steps: 150001 > 150000.",
    "code": "budgetExceeded",
    "budget": "steps",
    "current": 150001,
    "limit": 150000
  },
  "final": {
    "id": "04-semver-coerce-sort.safejs",
    "kind": "return",
    "value": {
      "coercions": [
        {
          "input": "release v1.2.3.4",
          "ltr": "1.2.3",
          "rtl": "2.3.4"
        },
        {
          "input": "1.2.3/4",
          "ltr": "1.2.3",
          "rtl": "4.0.0"
        },
        {
          "input": "版本 42.6.7.9.3-rc.1",
          "ltr": "42.6.7",
          "rtl": "1.0.0"
        },
        {
          "input": "10000000000000000.4.7.4",
          "ltr": "4.7.4",
          "rtl": "4.7.4"
        },
        {
          "input": "v3.4 replaces v3.3.1",
          "ltr": "3.4.0",
          "rtl": "3.3.1"
        },
        {
          "input": "words only",
          "ltr": null,
          "rtl": null
        },
        {
          "input": 2,
          "ltr": "2.0.0",
          "rtl": "2.0.0"
        },
        {
          "input": null,
          "ltr": null,
          "rtl": null
        }
      ],
      "ordered": [
        "1.0.0-alpha",
        "1.0.0-alpha.1",
        "1.0.0-alpha.beta",
        "1.0.0-beta",
        "1.0.0-beta.2",
        "1.0.0-beta.11",
        "1.0.0-rc.1",
        "1.0.0"
      ],
      "parsed": [
        {
          "core": [1, 2, 3],
          "prerelease": [],
          "build": "build.7",
          "version": "1.2.3+build.7"
        },
        null,
        null,
        null,
        {
          "core": [1, 2, 3],
          "prerelease": ["rc", "2"],
          "build": "",
          "version": "1.2.3-rc.2"
        }
      ]
    },
    "stats": {
      "nodeVisits": 10834
    },
    "steps": 10834
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### 06-template-replacement-unicode.safejs

Source: `strings/examples/06-template-replacement-unicode.safejs`; bindings: `{}`.

```json
{
  "native": [
    {
      "tokens": [
        {
          "name": "name",
          "fallback": "",
          "offset": 2,
          "raw": "{{name}}"
        },
        {
          "name": "missing",
          "fallback": "é",
          "offset": 13,
          "raw": "{{missing|é}}"
        }
      ],
      "captures": [
        {
          "name": "name",
          "fallback": null,
          "offset": 2,
          "inputLength": 28
        },
        {
          "name": "missing",
          "fallback": "é",
          "offset": 13,
          "inputLength": 28
        }
      ],
      "rendered": "🧪名称 / é!",
      "annotated": "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
      "prefixViews": "🧪<🧪> / <🧪{{name}} / >!",
      "suffixViews": "🧪< / {{missing|é}}!> / <!>!",
      "codePoints": [129514, 21517, 31216, 32, 47, 32, 233, 33],
      "normalized": "🧪名称 / é!",
      "pieces": ["🧪", "{{name}}", " / ", "{{missing|é}}", "!"],
      "literalReplacement": "🧪$& / {{missing|é}}!",
      "sourceTemplate": "prefix\\n名称\\tend"
    },
    {
      "tokens": [
        {
          "name": "name",
          "fallback": "",
          "offset": 0,
          "raw": "{{name}}"
        },
        {
          "name": "name",
          "fallback": "",
          "offset": 9,
          "raw": "{{name}}"
        },
        {
          "name": "count",
          "fallback": "zero",
          "offset": 18,
          "raw": "{{count|zero}}"
        }
      ],
      "captures": [
        {
          "name": "name",
          "fallback": null,
          "offset": 0,
          "inputLength": 32
        },
        {
          "name": "name",
          "fallback": null,
          "offset": 9,
          "inputLength": 32
        },
        {
          "name": "count",
          "fallback": "zero",
          "offset": 18,
          "inputLength": 32
        }
      ],
      "rendered": "café-café-0",
      "annotated": "[name:|$|{{name}}]-[name:|$|{{name}}]-[count:zero|$|{{count|zero}}]",
      "prefixViews": "<>-<{{name}}->-<{{name}}-{{name}}->",
      "suffixViews": "<-{{name}}-{{count|zero}}>-<-{{count|zero}}>-<>",
      "codePoints": [99, 97, 102, 233, 45, 99, 97, 102, 233, 45, 48],
      "normalized": "café-café-0",
      "pieces": ["", "{{name}}", "-", "{{name}}", "-", "{{count|zero}}", ""],
      "literalReplacement": "$&-$&-{{count|zero}}",
      "sourceTemplate": "prefix\\ncafé\\tend"
    },
    {
      "tokens": [],
      "captures": [],
      "rendered": "literal 🧪 é",
      "annotated": "literal 🧪 é",
      "prefixViews": "literal 🧪 é",
      "suffixViews": "literal 🧪 é",
      "codePoints": [108, 105, 116, 101, 114, 97, 108, 32, 129514, 32, 101, 769],
      "normalized": "literal 🧪 é",
      "pieces": ["literal 🧪 é"],
      "literalReplacement": "literal 🧪 é",
      "sourceTemplate": "prefix\\nΩ\\tend"
    }
  ],
  "baseline": {
    "id": "06-template-replacement-unicode.safejs",
    "kind": "return",
    "value": [
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": {
              "$type": "undefined"
            },
            "raw": "{{name}}"
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": {
              "$type": "undefined"
            },
            "raw": "{{missing|é}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 2,
            "inputLength": 28
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "inputLength": 28
          }
        ],
        "rendered": "🧪名称 / é!",
        "annotated": "🧪[name:$2|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
        "prefixViews": "🧪<$`> / <$`>!",
        "suffixViews": "🧪<$'> / <$'>!",
        "codePoints": [129514, 21517, 31216, 32, 47, 32, 233, 33],
        "normalized": "🧪名称 / é!",
        "pieces": ["🧪", "{{name}}", " / ", "{{missing|é}}", "!"],
        "literalReplacement": "🧪$& / {{missing|é}}!",
        "sourceTemplate": "prefix\\n名称\\tend"
      },
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": {
              "$type": "undefined"
            },
            "raw": "{{name}}"
          },
          {
            "name": "name",
            "fallback": "",
            "offset": {
              "$type": "undefined"
            },
            "raw": "{{name}}"
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": {
              "$type": "undefined"
            },
            "raw": "{{count|zero}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 0,
            "inputLength": 32
          },
          {
            "name": "name",
            "fallback": null,
            "offset": 9,
            "inputLength": 32
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "inputLength": 32
          }
        ],
        "rendered": "café-café-0",
        "annotated": "[name:$2|$|{{name}}]-[name:$2|$|{{name}}]-[count:zero|$|{{count|zero}}]",
        "prefixViews": "<$`>-<$`>-<$`>",
        "suffixViews": "<$'>-<$'>-<$'>",
        "codePoints": [99, 97, 102, 233, 45, 99, 97, 102, 233, 45, 48],
        "normalized": "café-café-0",
        "pieces": ["", "{{name}}", "-", "{{name}}", "-", "{{count|zero}}", ""],
        "literalReplacement": "$&-$&-{{count|zero}}",
        "sourceTemplate": "prefix\\ncafé\\tend"
      },
      {
        "tokens": [],
        "captures": [],
        "rendered": "literal 🧪 é",
        "annotated": "literal 🧪 é",
        "prefixViews": "literal 🧪 é",
        "suffixViews": "literal 🧪 é",
        "codePoints": [108, 105, 116, 101, 114, 97, 108, 32, 129514, 32, 101, 769],
        "normalized": "literal 🧪 é",
        "pieces": ["literal 🧪 é"],
        "literalReplacement": "literal 🧪 é",
        "sourceTemplate": "prefix\\nΩ\\tend"
      }
    ],
    "stats": {
      "nodeVisits": 619
    }
  },
  "final": {
    "id": "06-template-replacement-unicode.safejs",
    "kind": "return",
    "value": [
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": 2,
            "raw": "{{name}}"
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "raw": "{{missing|é}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 2,
            "inputLength": 28
          },
          {
            "name": "missing",
            "fallback": "é",
            "offset": 13,
            "inputLength": 28
          }
        ],
        "rendered": "🧪名称 / é!",
        "annotated": "🧪[name:$2|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
        "prefixViews": "🧪<$`> / <$`>!",
        "suffixViews": "🧪<$'> / <$'>!",
        "codePoints": [129514, 21517, 31216, 32, 47, 32, 233, 33],
        "normalized": "🧪名称 / é!",
        "pieces": ["🧪", "{{name}}", " / ", "{{missing|é}}", "!"],
        "literalReplacement": "🧪$& / {{missing|é}}!",
        "sourceTemplate": "prefix\\n名称\\tend"
      },
      {
        "tokens": [
          {
            "name": "name",
            "fallback": "",
            "offset": 0,
            "raw": "{{name}}"
          },
          {
            "name": "name",
            "fallback": "",
            "offset": 9,
            "raw": "{{name}}"
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "raw": "{{count|zero}}"
          }
        ],
        "captures": [
          {
            "name": "name",
            "fallback": null,
            "offset": 0,
            "inputLength": 32
          },
          {
            "name": "name",
            "fallback": null,
            "offset": 9,
            "inputLength": 32
          },
          {
            "name": "count",
            "fallback": "zero",
            "offset": 18,
            "inputLength": 32
          }
        ],
        "rendered": "café-café-0",
        "annotated": "[name:$2|$|{{name}}]-[name:$2|$|{{name}}]-[count:zero|$|{{count|zero}}]",
        "prefixViews": "<$`>-<$`>-<$`>",
        "suffixViews": "<$'>-<$'>-<$'>",
        "codePoints": [99, 97, 102, 233, 45, 99, 97, 102, 233, 45, 48],
        "normalized": "café-café-0",
        "pieces": ["", "{{name}}", "-", "{{name}}", "-", "{{count|zero}}", ""],
        "literalReplacement": "$&-$&-{{count|zero}}",
        "sourceTemplate": "prefix\\ncafé\\tend"
      },
      {
        "tokens": [],
        "captures": [],
        "rendered": "literal 🧪 é",
        "annotated": "literal 🧪 é",
        "prefixViews": "literal 🧪 é",
        "suffixViews": "literal 🧪 é",
        "codePoints": [108, 105, 116, 101, 114, 97, 108, 32, 129514, 32, 101, 769],
        "normalized": "literal 🧪 é",
        "pieces": ["literal 🧪 é"],
        "literalReplacement": "literal 🧪 é",
        "sourceTemplate": "prefix\\nΩ\\tend"
      }
    ],
    "stats": {
      "nodeVisits": 619
    },
    "steps": 619
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": [
    {
      "path": "0.annotated",
      "expected": "🧪[name:|$|{{name}}] / [missing:é|$|{{missing|é}}]!",
      "actual": "🧪[name:$2|$|{{name}}] / [missing:é|$|{{missing|é}}]!"
    },
    {
      "path": "0.prefixViews",
      "expected": "🧪<🧪> / <🧪{{name}} / >!",
      "actual": "🧪<$`> / <$`>!"
    },
    {
      "path": "0.suffixViews",
      "expected": "🧪< / {{missing|é}}!> / <!>!",
      "actual": "🧪<$'> / <$'>!"
    },
    {
      "path": "1.annotated",
      "expected": "[name:|$|{{name}}]-[name:|$|{{name}}]-[count:zero|$|{{count|zero}}]",
      "actual": "[name:$2|$|{{name}}]-[name:$2|$|{{name}}]-[count:zero|$|{{count|zero}}]"
    },
    {
      "path": "1.prefixViews",
      "expected": "<>-<{{name}}->-<{{name}}-{{name}}->",
      "actual": "<$`>-<$`>-<$`>"
    },
    {
      "path": "1.suffixViews",
      "expected": "<-{{name}}-{{count|zero}}>-<-{{count|zero}}>-<>",
      "actual": "<$'>-<$'>-<$'>"
    }
  ]
}
```

### 07-mustache-scanner-offset.safejs

Source: `strings/examples/07-mustache-scanner-offset.safejs`; bindings: `{}`.

```json
{
  "native": [
    {
      "tokens": [
        ["text", "🧪 ", 0],
        ["name", "name", 13],
        ["text", ":", 13],
        ["#", "items", 24],
        ["name", "title", 33],
        ["^", "tags", 42],
        ["text", "empty", 42],
        ["/", "tags", 56],
        ["/", "items", 66],
        ["text", "!", 66]
      ],
      "remaining": "",
      "consumed": 67
    },
    {
      "tokens": [
        ["!", "note", 10],
        ["&", "html", 20],
        ["text", " ", 20],
        ["name", "user.name", 34]
      ],
      "remaining": "",
      "consumed": 34
    },
    {
      "tokens": [
        ["text", "prefix ", 0],
        ["name", "x", 12],
        ["text", " suffix", 12]
      ],
      "remaining": "",
      "consumed": 19
    },
    {
      "tokens": [["text", "plain é 名称", 0]],
      "remaining": "",
      "consumed": 11
    }
  ],
  "baseline": {
    "id": "07-mustache-scanner-offset.safejs",
    "kind": "return",
    "value": [
      {
        "tokens": [["text", "🧪 ", 0]],
        "remaining": "{{ name }}:{{#items}}{{title}}{{^tags}}empty{{/tags}}{{/items}}!",
        "consumed": 3
      },
      {
        "tokens": [],
        "remaining": "{{! note}}{{& html}} {{user.name}}",
        "consumed": 0
      },
      {
        "tokens": [["text", "prefix ", 0]],
        "remaining": "{{x}} suffix",
        "consumed": 7
      },
      {
        "tokens": [["text", "plain é 名称", 0]],
        "remaining": "",
        "consumed": 11
      }
    ],
    "stats": {
      "nodeVisits": 465
    }
  },
  "final": {
    "id": "07-mustache-scanner-offset.safejs",
    "kind": "return",
    "value": [
      {
        "tokens": [
          ["text", "🧪 ", 0],
          ["name", "name", 13],
          ["text", ":", 13],
          ["#", "items", 24],
          ["name", "title", 33],
          ["^", "tags", 42],
          ["text", "empty", 42],
          ["/", "tags", 56],
          ["/", "items", 66],
          ["text", "!", 66]
        ],
        "remaining": "",
        "consumed": 67
      },
      {
        "tokens": [
          ["!", "note", 10],
          ["&", "html", 20],
          ["text", " ", 20],
          ["name", "user.name", 34]
        ],
        "remaining": "",
        "consumed": 34
      },
      {
        "tokens": [
          ["text", "prefix ", 0],
          ["name", "x", 12],
          ["text", " suffix", 12]
        ],
        "remaining": "",
        "consumed": 19
      },
      {
        "tokens": [["text", "plain é 名称", 0]],
        "remaining": "",
        "consumed": 11
      }
    ],
    "stats": {
      "nodeVisits": 2999
    },
    "steps": 2999
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### r01-match-metadata.safejs

Source: `strings/reductions/r01-match-metadata.safejs`; bindings: `{}`.

```json
{
  "native": [
    {
      "text": "ab",
      "capture": "b",
      "index": "2",
      "input": "🧪ab",
      "keys": ["0", "1", "index", "input", "groups"]
    },
    {
      "text": "ab",
      "capture": "b",
      "index": "2",
      "input": "🧪ab",
      "keys": ["0", "1", "index", "input", "groups"]
    },
    {
      "text": "ab",
      "capture": "b",
      "index": "2",
      "input": "🧪ab",
      "keys": ["0", "1", "index", "input", "groups"]
    }
  ],
  "baseline": {
    "id": "r01-match-metadata.safejs",
    "kind": "return",
    "value": [
      {
        "text": "ab",
        "capture": "b",
        "index": "undefined",
        "input": "undefined",
        "keys": ["0", "1", "groups", "index", "input"]
      },
      {
        "text": "ab",
        "capture": "b",
        "index": "undefined",
        "input": "undefined",
        "keys": ["0", "1", "groups", "index", "input"]
      },
      {
        "text": "ab",
        "capture": "b",
        "index": "undefined",
        "input": "undefined",
        "keys": ["0", "1", "groups", "index", "input"]
      }
    ],
    "stats": {
      "nodeVisits": 79
    }
  },
  "final": {
    "id": "r01-match-metadata.safejs",
    "kind": "return",
    "value": [
      {
        "text": "ab",
        "capture": "b",
        "index": "2",
        "input": "🧪ab",
        "keys": ["0", "1", "groups", "index", "input"]
      },
      {
        "text": "ab",
        "capture": "b",
        "index": "2",
        "input": "🧪ab",
        "keys": ["0", "1", "groups", "index", "input"]
      },
      {
        "text": "ab",
        "capture": "b",
        "index": "2",
        "input": "🧪ab",
        "keys": ["0", "1", "groups", "index", "input"]
      }
    ],
    "stats": {
      "nodeVisits": 79
    },
    "steps": 79
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": [
    {
      "path": "0.keys.2",
      "expected": "index",
      "actual": "groups"
    },
    {
      "path": "0.keys.3",
      "expected": "input",
      "actual": "index"
    },
    {
      "path": "0.keys.4",
      "expected": "groups",
      "actual": "input"
    },
    {
      "path": "1.keys.2",
      "expected": "index",
      "actual": "groups"
    },
    {
      "path": "1.keys.3",
      "expected": "input",
      "actual": "index"
    },
    {
      "path": "1.keys.4",
      "expected": "groups",
      "actual": "input"
    },
    {
      "path": "2.keys.2",
      "expected": "index",
      "actual": "groups"
    },
    {
      "path": "2.keys.3",
      "expected": "input",
      "actual": "index"
    },
    {
      "path": "2.keys.4",
      "expected": "groups",
      "actual": "input"
    }
  ]
}
```

### r02-semver-overlap-progress.safejs

Source: `strings/reductions/r02-semver-overlap-progress.safejs`; bindings: `{}`.

```json
{
  "native": [
    {
      "text": "v1.2.3.",
      "index": "8",
      "lastIndex": "10",
      "tuple": ["1", "2", "3"]
    },
    {
      "text": ".2.3.4",
      "index": "10",
      "lastIndex": "12",
      "tuple": ["2", "3", "4"]
    }
  ],
  "baseline": {
    "id": "r02-semver-overlap-progress.safejs",
    "kind": "return",
    "value": [
      {
        "text": "v1.2.3.",
        "index": "undefined",
        "lastIndex": "NaN",
        "tuple": ["1", "2", "3"]
      },
      {
        "text": "v1.2.3.",
        "index": "undefined",
        "lastIndex": "NaN",
        "tuple": ["1", "2", "3"]
      },
      {
        "text": "v1.2.3.",
        "index": "undefined",
        "lastIndex": "NaN",
        "tuple": ["1", "2", "3"]
      },
      {
        "text": "v1.2.3.",
        "index": "undefined",
        "lastIndex": "NaN",
        "tuple": ["1", "2", "3"]
      },
      {
        "text": "v1.2.3.",
        "index": "undefined",
        "lastIndex": "NaN",
        "tuple": ["1", "2", "3"]
      }
    ],
    "stats": {
      "nodeVisits": 443
    }
  },
  "final": {
    "id": "r02-semver-overlap-progress.safejs",
    "kind": "return",
    "value": [
      {
        "text": "v1.2.3.",
        "index": "8",
        "lastIndex": "10",
        "tuple": ["1", "2", "3"]
      },
      {
        "text": ".2.3.4",
        "index": "10",
        "lastIndex": "12",
        "tuple": ["2", "3", "4"]
      }
    ],
    "stats": {
      "nodeVisits": 196
    },
    "steps": 196
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### 09-histogram-object-configuration.ajs

Source: `numerics/09-histogram-object-configuration.ajs`; bindings: `{}`.

```json
{
  "native": {
    "original": [
      {
        "start": 0,
        "stop": 2.5,
        "ids": [1, 2]
      },
      {
        "start": 2.5,
        "stop": 5,
        "ids": [3, 4, 5]
      },
      {
        "start": 5,
        "stop": 7.5,
        "ids": [6]
      },
      {
        "start": 7.5,
        "stop": 10,
        "ids": [7, 8]
      },
      {
        "start": 10,
        "stop": 10,
        "ids": [9]
      }
    ],
    "afterInputChange": [
      {
        "start": 0,
        "stop": 2.5,
        "ids": [1, 2]
      },
      {
        "start": 2.5,
        "stop": 5,
        "ids": [3, 4, 5]
      },
      {
        "start": 5,
        "stop": 7.5,
        "ids": [6]
      },
      {
        "start": 7.5,
        "stop": 10,
        "ids": [7, 8]
      },
      {
        "start": 10,
        "stop": 10,
        "ids": [9]
      }
    ],
    "narrower": [
      {
        "start": 2.5,
        "stop": 5,
        "ids": [3, 4, 5]
      },
      {
        "start": 5,
        "stop": 7.5,
        "ids": [6]
      },
      {
        "start": 7.5,
        "stop": 7.5,
        "ids": [7]
      }
    ],
    "configuredDomain": [2.5, 7.5],
    "configuredThresholds": [2.5, 5, 7.5],
    "accessorValue": 4.5
  },
  "baseline": {
    "id": "09-histogram-object-configuration.ajs",
    "kind": "return",
    "value": {
      "original": [
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [1, 2]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [3, 4, 5]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [6]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [7, 8]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [9]
        }
      ],
      "afterInputChange": [
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [1, 2]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [3, 4, 5]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [6]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [7, 8]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [9]
        }
      ],
      "narrower": [
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [3, 4, 5]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [6]
        },
        {
          "start": {
            "$type": "undefined"
          },
          "stop": {
            "$type": "undefined"
          },
          "ids": [7]
        }
      ],
      "configuredDomain": [2.5, 7.5],
      "configuredThresholds": [2.5, 5, 7.5],
      "accessorValue": 4.5
    },
    "stats": {
      "nodeVisits": 3
    }
  },
  "final": {
    "id": "09-histogram-object-configuration.ajs",
    "kind": "return",
    "value": {
      "original": [
        {
          "start": 0,
          "stop": 2.5,
          "ids": [1, 2]
        },
        {
          "start": 2.5,
          "stop": 5,
          "ids": [3, 4, 5]
        },
        {
          "start": 5,
          "stop": 7.5,
          "ids": [6]
        },
        {
          "start": 7.5,
          "stop": 10,
          "ids": [7, 8]
        },
        {
          "start": 10,
          "stop": 10,
          "ids": [9]
        }
      ],
      "afterInputChange": [
        {
          "start": 0,
          "stop": 2.5,
          "ids": [1, 2]
        },
        {
          "start": 2.5,
          "stop": 5,
          "ids": [3, 4, 5]
        },
        {
          "start": 5,
          "stop": 7.5,
          "ids": [6]
        },
        {
          "start": 7.5,
          "stop": 10,
          "ids": [7, 8]
        },
        {
          "start": 10,
          "stop": 10,
          "ids": [9]
        }
      ],
      "narrower": [
        {
          "start": 2.5,
          "stop": 5,
          "ids": [3, 4, 5]
        },
        {
          "start": 5,
          "stop": 7.5,
          "ids": [6]
        },
        {
          "start": 7.5,
          "stop": 7.5,
          "ids": [7]
        }
      ],
      "configuredDomain": [2.5, 7.5],
      "configuredThresholds": [2.5, 5, 7.5],
      "accessorValue": 4.5
    },
    "stats": {
      "nodeVisits": 3
    },
    "steps": 3904
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### 13-array-metadata-reduction.ajs

Source: `numerics/13-array-metadata-reduction.ajs`; bindings: `{}`.

```json
{
  "native": {
    "hasStart": true,
    "keys": ["0", "1", "x0", "x1"],
    "start": 2.5,
    "stop": 7.5,
    "count": 2
  },
  "baseline": {
    "id": "13-array-metadata-reduction.ajs",
    "kind": "return",
    "value": {
      "hasStart": true,
      "keys": ["0", "1", "x0", "x1"],
      "start": {
        "$type": "undefined"
      },
      "stop": {
        "$type": "undefined"
      },
      "count": 2
    },
    "stats": {
      "nodeVisits": 3
    }
  },
  "final": {
    "id": "13-array-metadata-reduction.ajs",
    "kind": "return",
    "value": {
      "hasStart": true,
      "keys": ["0", "1", "x0", "x1"],
      "start": 2.5,
      "stop": 7.5,
      "count": 2
    },
    "stats": {
      "nodeVisits": 3
    },
    "steps": 36
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### lcs-records

Source: `data-pipelines/lcs-array-diff.ajs`; bindings: `{"caseName":"records"}`.

```json
{
  "native": {
    "lcs": {
      "leftIndices": [1, 2, 4],
      "rightIndices": [0, 1, 4],
      "ids": ["b", "c", "e"]
    },
    "edits": [
      {
        "kind": "remove",
        "index": 3,
        "id": "d"
      },
      {
        "kind": "remove",
        "index": 0,
        "id": "a"
      },
      {
        "kind": "update",
        "index": 0,
        "id": "b"
      },
      {
        "kind": "insert",
        "index": 2,
        "id": "f"
      },
      {
        "kind": "insert",
        "index": 3,
        "id": "a"
      }
    ],
    "result": [
      {
        "id": "b",
        "value": 20
      },
      {
        "id": "c",
        "value": 3
      },
      {
        "id": "f",
        "value": 6
      },
      {
        "id": "a",
        "value": 10
      },
      {
        "id": "e",
        "value": 5
      }
    ],
    "matches": true,
    "originalUnchanged": true
  },
  "baseline": {
    "id": "lcs-records",
    "kind": "throw",
    "name": "TypeError",
    "message": "Array#match is not a supported method.",
    "code": {
      "$type": "undefined"
    },
    "budget": {
      "$type": "undefined"
    },
    "current": {
      "$type": "undefined"
    },
    "limit": {
      "$type": "undefined"
    }
  },
  "final": {
    "id": "lcs-records",
    "kind": "return",
    "value": {
      "lcs": {
        "leftIndices": [1, 2, 4],
        "rightIndices": [0, 1, 4],
        "ids": ["b", "c", "e"]
      },
      "edits": [
        {
          "kind": "remove",
          "index": 3,
          "id": "d"
        },
        {
          "kind": "remove",
          "index": 0,
          "id": "a"
        },
        {
          "kind": "update",
          "index": 0,
          "id": "b"
        },
        {
          "kind": "insert",
          "index": 2,
          "id": "f"
        },
        {
          "kind": "insert",
          "index": 3,
          "id": "a"
        }
      ],
      "result": [
        {
          "id": "b",
          "value": 20
        },
        {
          "id": "c",
          "value": 3
        },
        {
          "id": "f",
          "value": 6
        },
        {
          "id": "a",
          "value": 10
        },
        {
          "id": "e",
          "value": 5
        }
      ],
      "matches": true,
      "originalUnchanged": true
    },
    "stats": {
      "nodeVisits": 2223
    },
    "steps": 2223
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### lcs-duplicates

Source: `data-pipelines/lcs-array-diff.ajs`; bindings: `{"caseName":"duplicate-ids"}`.

```json
{
  "native": {
    "lcs": {
      "leftIndices": [1, 2, 3, 4],
      "rightIndices": [0, 1, 3, 4],
      "ids": ["b", "c", "b", "e"]
    },
    "edits": [
      {
        "kind": "remove",
        "index": 0,
        "id": "a"
      },
      {
        "kind": "update",
        "index": 0,
        "id": "b"
      },
      {
        "kind": "insert",
        "index": 2,
        "id": "f"
      },
      {
        "kind": "update",
        "index": 3,
        "id": "b"
      }
    ],
    "result": [
      {
        "id": "b",
        "value": 20
      },
      {
        "id": "c",
        "value": 3
      },
      {
        "id": "f",
        "value": 6
      },
      {
        "id": "b",
        "value": 10
      },
      {
        "id": "e",
        "value": 5
      }
    ],
    "matches": true,
    "originalUnchanged": true
  },
  "baseline": {
    "id": "lcs-duplicates",
    "kind": "throw",
    "name": "TypeError",
    "message": "Array#match is not a supported method.",
    "code": {
      "$type": "undefined"
    },
    "budget": {
      "$type": "undefined"
    },
    "current": {
      "$type": "undefined"
    },
    "limit": {
      "$type": "undefined"
    }
  },
  "final": {
    "id": "lcs-duplicates",
    "kind": "return",
    "value": {
      "lcs": {
        "leftIndices": [1, 2, 3, 4],
        "rightIndices": [0, 1, 3, 4],
        "ids": ["b", "c", "b", "e"]
      },
      "edits": [
        {
          "kind": "remove",
          "index": 0,
          "id": "a"
        },
        {
          "kind": "update",
          "index": 0,
          "id": "b"
        },
        {
          "kind": "insert",
          "index": 2,
          "id": "f"
        },
        {
          "kind": "update",
          "index": 3,
          "id": "b"
        }
      ],
      "result": [
        {
          "id": "b",
          "value": 20
        },
        {
          "id": "c",
          "value": 3
        },
        {
          "id": "f",
          "value": 6
        },
        {
          "id": "b",
          "value": 10
        },
        {
          "id": "e",
          "value": 5
        }
      ],
      "matches": true,
      "originalUnchanged": true
    },
    "stats": {
      "nodeVisits": 2169
    },
    "steps": 2169
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

### lcs-empty-left

Source: `data-pipelines/lcs-array-diff.ajs`; bindings: `{"caseName":"empty-left"}`.

```json
{
  "native": {
    "lcs": {
      "leftIndices": [],
      "rightIndices": [],
      "ids": []
    },
    "edits": [
      {
        "kind": "insert",
        "index": 0,
        "id": "b"
      },
      {
        "kind": "insert",
        "index": 1,
        "id": "c"
      },
      {
        "kind": "insert",
        "index": 2,
        "id": "f"
      },
      {
        "kind": "insert",
        "index": 3,
        "id": "a"
      },
      {
        "kind": "insert",
        "index": 4,
        "id": "e"
      }
    ],
    "result": [
      {
        "id": "b",
        "value": 20
      },
      {
        "id": "c",
        "value": 3
      },
      {
        "id": "f",
        "value": 6
      },
      {
        "id": "a",
        "value": 10
      },
      {
        "id": "e",
        "value": 5
      }
    ],
    "matches": true,
    "originalUnchanged": true
  },
  "baseline": {
    "id": "lcs-empty-left",
    "kind": "return",
    "value": {
      "lcs": {
        "leftIndices": [],
        "rightIndices": [],
        "ids": []
      },
      "edits": [
        {
          "kind": "insert",
          "index": 0,
          "id": "b"
        },
        {
          "kind": "insert",
          "index": 1,
          "id": "c"
        },
        {
          "kind": "insert",
          "index": 2,
          "id": "f"
        },
        {
          "kind": "insert",
          "index": 3,
          "id": "a"
        },
        {
          "kind": "insert",
          "index": 4,
          "id": "e"
        }
      ],
      "result": [
        {
          "id": "b",
          "value": 20
        },
        {
          "id": "c",
          "value": 3
        },
        {
          "id": "f",
          "value": 6
        },
        {
          "id": "a",
          "value": 10
        },
        {
          "id": "e",
          "value": 5
        }
      ],
      "matches": true,
      "originalUnchanged": true
    },
    "stats": {
      "nodeVisits": 324
    }
  },
  "final": {
    "id": "lcs-empty-left",
    "kind": "return",
    "value": {
      "lcs": {
        "leftIndices": [],
        "rightIndices": [],
        "ids": []
      },
      "edits": [
        {
          "kind": "insert",
          "index": 0,
          "id": "b"
        },
        {
          "kind": "insert",
          "index": 1,
          "id": "c"
        },
        {
          "kind": "insert",
          "index": 2,
          "id": "f"
        },
        {
          "kind": "insert",
          "index": 3,
          "id": "a"
        },
        {
          "kind": "insert",
          "index": 4,
          "id": "e"
        }
      ],
      "result": [
        {
          "id": "b",
          "value": 20
        },
        {
          "id": "c",
          "value": 3
        },
        {
          "id": "f",
          "value": 6
        },
        {
          "id": "a",
          "value": 10
        },
        {
          "id": "e",
          "value": 5
        }
      ],
      "matches": true,
      "originalUnchanged": true
    },
    "stats": {
      "nodeVisits": 324
    },
    "steps": 324
  },
  "finalRepeatExactlyEqual": true,
  "remainingDifferences": []
}
```

## Call-order repair after Noether validation

Observed: 2026-08-28T23:40:30-0500. Base remains `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`. The user released the production freeze only for this repair in the same isolated clone. No Git mutations, README changes, external-workspace writes, new host capabilities, or validator-owned file edits occurred.

### Repair scope and root cause

Only three paths changed during this repair round:

- `packages/safejs/src/interp/interpreter.ts`
- `packages/safejs/src/run.call-order.test.ts` (new author-owned regressions)
- `docs/plans/safejs-fix-array-own-metadata.md`

The existing ordinary call helper checked callability before arguments. Array-own dispatch exposed that shared defect; object members and identifier calls also reproduced it. The repair is generic, not an array side-effect special case: preserve the already captured callee and receiver; return immediately only for a nullish optional callee; evaluate arguments; propagate an argument's abrupt completion; then reject a noncallable callee or invoke the captured closure. No member is reread after argument side effects.

Exact production delta relative to the independently rejected candidate:

```diff
--- before-repair
+++ after-repair
@@ -3281,25 +3281,21 @@
   context: EvaluationContext,
   thisValue: SandboxValue = undefined
 ): Promise<EvaluationResult> {
-  if (callee === null || callee === undefined) {
-    if (node.optional) {
-      return {
-        kind: "normal",
-        hasValue: true,
-        value: undefined
-      };
-    }
-
-    throw new TypeError("Attempted to call a non-function value.");
+  if ((callee === null || callee === undefined) && node.optional) {
+    return {
+      kind: "normal",
+      hasValue: true,
+      value: undefined
+    };
   }

-  if (!isSandboxClosure(callee)) {
-    throw new TypeError("Attempted to call a non-function value.");
-  }
-
   const args = await evaluateCallArguments(node.arguments, context);
   if (!args.ok) {
     return args.result;
+  }
+
+  if (!isSandboxClosure(callee)) {
+    throw new TypeError("Attempted to call a non-function value.");
   }

   return {
```

### Actual RED and GREEN execution

Frozen focused command, executed before any production repair:

`./node_modules/.bin/vitest run packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/metadata-validation.test.ts --reporter=verbose`

- RED: **21 pass, 5 fail / 26**, exit 1, 708 ms. The five unchanged validator assertions fail for undefined, null, false, zero, and empty string.
- GREEN after root repair: **26 pass / 26**, exit 0, 653 ms. No validator assertion or fixture was changed.
- Historical validator base result **14/14 fail** remains preserved, not overwritten or rerun as a new success.

New generic command:

`./node_modules/.bin/vitest run packages/safejs/src/run.call-order.test.ts --reporter=verbose`

- RED before root repair: **13 fail, 2 pass / 15**, exit 1, 620 ms.
- GREEN: **15 pass / 15**, exit 0, 573 ms.
- These native-first cases cover identifier/object calls for all five noncallable values, optional nullish short-circuiting, receiver/key/argument ordering, captured callee and receiver identity despite argument mutation, replacement of a noncallable member during argument evaluation, thrown-argument precedence, spread argument ordering, and short-circuiting before computed keys for a nullish receiver.

The unchanged broader validator selection:

`./node_modules/.bin/vitest run packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/metadata-validation.test.ts packages/safejs/src/run.references.test.ts packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/interp/methods --testNamePattern='^(?!.*(?:exposes intercepted array members|does not expose prototypes|dangerous array properties|does not expose host prototypes|__proto__|inherited|spreads only an object)).*$' --reporter=dot`

Result: **656 pass, 0 fail, 9 intentionally filtered / 665**, nine files, exit 0, 1.79 seconds. Historical **651 pass, 5 fail, 9 filtered** evidence stays untouched.

Expanded selection adds `packages/safejs/src/run.call-order.test.ts` and `packages/safejs/src/run.promise-order.test.ts` to that same command. Result: **710 pass, 0 fail, 9 intentionally filtered / 719**, eleven files, exit 0, 2.11 seconds. This includes existing method callbacks, optional calls, argument/reference evaluation, receiver handling, and promise scheduling controls. It is not a full repository or adversarial run.

Existing checkpoint/await controls:

`./node_modules/.bin/vitest run packages/safejs/src/run.snapshot.test.ts --testNamePattern='preserves .* when restoring an await checkpoint' --reporter=verbose`

Result: **5 pass, 26 intentionally filtered / 31**, exit 0, 894 ms. These use the existing memfs fixtures and do not execute agent/LLM cases. They do not cover or close the pending custom-array-metadata serialization failure.

Additional checks actually executed:

- `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`: PASS, exit 0.
- `./node_modules/.bin/tsc --target ES2022 --module NodeNext --moduleResolution NodeNext --strict --esModuleInterop --skipLibCheck --noEmit packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/interp/methods/array.test.ts packages/safejs/src/metadata-validation.test.ts packages/safejs/src/run.call-order.test.ts`: PASS, exit 0.
- ESLint on the changed interpreter and new call-order tests: PASS, exit 0.
- Prettier check on the changed interpreter and new test: PASS, exit 0.
- `git diff --check`: PASS, exit 0; this is read-only, not a Git mutation.
- The previously documented 154 legacy interpreter-test typing diagnostics remain separate historical evidence; that extra command was not rerun or claimed fixed by this repair.

A recording-helper attempt to import TypeScript through the persistent REPL exposed no module exports and failed twice before extracting cases. The executable child using the installed TypeScript module then parsed the frozen validator test successfully; no validator source was transformed on disk. These helper failures were not counted as RED or GREEN runtime verdicts.

### Complete five-blocker case outputs

The exact five source strings were extracted from the frozen validator's first source template through the TypeScript AST, substituting only its existing literal parameter. Native results were established before the pre-repair SafeJS runs. The same unchanged sources ran twice after repair with `modules: {}`, no bindings/capabilities, a 192 MiB child heap, 10-second child timeout, maxSteps 10000 and maxCallDepth 24. Both complete post-repair outputs and step counts match. Undefined is encoded as `{"$type":"undefined"}`; no array elements or metadata observations are omitted.

#### Own undefined

```json
{
  "literal": "undefined",
  "sourceSha256": "5b26d42ff167fae735a2e955dab96981f2a78a12715e9c4e7d9b0a6bec8f0766",
  "native": [
    [
      true,
      {
        "$type": "undefined"
      },
      {
        "$type": "undefined"
      },
      ["argument", "TypeError"]
    ],
    [5, 8],
    false
  ],
  "preRepairActual": [
    [
      true,
      {
        "$type": "undefined"
      },
      {
        "$type": "undefined"
      },
      ["TypeError"]
    ],
    [5, 8],
    false
  ],
  "postRepairActual": [
    [
      true,
      {
        "$type": "undefined"
      },
      {
        "$type": "undefined"
      },
      ["argument", "TypeError"]
    ],
    [5, 8],
    false
  ],
  "preRepairSteps": 65,
  "postRepairSteps": 75,
  "postRepairRepeatExactlyEqual": true
}
```

#### Own null

```json
{
  "literal": "null",
  "sourceSha256": "1b7e246e259d89ee702a1e2ab9d91c244d5715b237b1995e9d7a02a0a45a285b",
  "native": [[true, null, null, ["argument", "TypeError"]], [5, 8], false],
  "preRepairActual": [[true, null, null, ["TypeError"]], [5, 8], false],
  "postRepairActual": [[true, null, null, ["argument", "TypeError"]], [5, 8], false],
  "preRepairSteps": 65,
  "postRepairSteps": 75,
  "postRepairRepeatExactlyEqual": true
}
```

#### Own false

```json
{
  "literal": "false",
  "sourceSha256": "979552c13d2fabc32ba616f86f04a50d9945a28b4264b40a9dc957eda0b6df18",
  "native": [
    [true, false, false, ["argument", "TypeError", "argument", "TypeError"]],
    [5, 8],
    false
  ],
  "preRepairActual": [[true, false, false, ["TypeError", "TypeError"]], [5, 8], false],
  "postRepairActual": [
    [true, false, false, ["argument", "TypeError", "argument", "TypeError"]],
    [5, 8],
    false
  ],
  "preRepairSteps": 71,
  "postRepairSteps": 91,
  "postRepairRepeatExactlyEqual": true
}
```

#### Own 0

```json
{
  "literal": "0",
  "sourceSha256": "56d3f8f695589b630eb56cfa01bb5917f819b1906a397bdbee452c1c41ec091a",
  "native": [[true, 0, 0, ["argument", "TypeError", "argument", "TypeError"]], [5, 8], false],
  "preRepairActual": [[true, 0, 0, ["TypeError", "TypeError"]], [5, 8], false],
  "postRepairActual": [
    [true, 0, 0, ["argument", "TypeError", "argument", "TypeError"]],
    [5, 8],
    false
  ],
  "preRepairSteps": 71,
  "postRepairSteps": 91,
  "postRepairRepeatExactlyEqual": true
}
```

#### Own ""

```json
{
  "literal": "\"\"",
  "sourceSha256": "6e4e127220b941c13541bbe2a87cae37400c59d3c5f91eb0aa601a2de9fb0fef",
  "native": [[true, "", "", ["argument", "TypeError", "argument", "TypeError"]], [5, 8], false],
  "preRepairActual": [[true, "", "", ["TypeError", "TypeError"]], [5, 8], false],
  "postRepairActual": [
    [true, "", "", ["argument", "TypeError", "argument", "TypeError"]],
    [5, 8],
    false
  ],
  "preRepairSteps": 71,
  "postRepairSteps": 91,
  "postRepairRepeatExactlyEqual": true
}
```

### Original full-output revalidation and pending qualifications

Bootstrapped the exact 38 exclusions again from the original audit's inventory-verification metadata, denied the entire security directory, and explicitly allowlisted only the eight previously identified functional source paths. No archive/family content search occurred and no excluded security payload was read, hashed, copied, or executed. Noether's corrected wording refers to **13 allowed historical functional inputs/bootstrap metadata files**, not excluded security material; this repair independently read only its own nine allowed inputs (one bootstrap plus eight original source files). All eight source hashes match the frozen validator's original result record.

Established all ten complete native outputs in a fresh child before running current originals. Every native output matches the frozen original expectation; both repaired-runtime repetitions match every complete pre-repair candidate output and step count exactly. The native-first protocol, untouched source hashes, full values and unchanged budgets are retained in the historical full-original-output sections of this author plan. No new replacement or serializer implementation was substituted. The complete current ten-result JSON array has SHA-256 `5ed310c7d1b6135690b244822a798b45bc375fc2ab9af38031ccdeb6884976b3` (JSON.stringify array, UTF-8, no trailing newline).

- 04-semver-coerce-sort.safejs: 10834 steps; full output equals frozen candidate; 0 native leaf differences remain.
- 06-template-replacement-unicode.safejs: 619 steps; full output equals frozen candidate; 6 native leaf differences remain.
- 07-mustache-scanner-offset.safejs: 2999 steps; full output equals frozen candidate; 0 native leaf differences remain.
- r01-match-metadata.safejs: 79 steps; full output equals frozen candidate; 9 native leaf differences remain.
- r02-semver-overlap-progress.safejs: 196 steps; full output equals frozen candidate; 0 native leaf differences remain.
- 09-histogram-object-configuration.ajs: 3904 steps; full output equals frozen candidate; 0 native leaf differences remain.
- 13-array-metadata-reduction.ajs: 36 steps; full output equals frozen candidate; 0 native leaf differences remain.
- lcs-records: 2223 steps; full output equals frozen candidate; 0 native leaf differences remain.
- lcs-duplicates: 2169 steps; full output equals frozen candidate; 0 native leaf differences remain.
- lcs-empty-left: 324 steps; full output equals frozen candidate; 0 native leaf differences remain.

Whole-fixture qualifications are still binding:

- **PENDING dedicated serializer followup:** named own array metadata and raw aliases are lost across checkpoint serialization. Expected keys ["0","metadata","raw"] become ["0"], and the named aliases disappear; indexed alias identity survives. This additional observed, unasserted baseline failure is real and unresolved, not a nonissue. The serializer around snapshot/serialize.ts:444 was not edited and the separate checkpoint witness was not asserted green. Main tracks this as its own row/lane.
- **PENDING dedicated regex-key-order followup:** the match-array own keys still differ in order, producing nine leaves in the unchanged r01 full fixture. Metadata readability passing does not erase this failure. No regex metadata insertion-order code was edited. Main tracks the separate regex lane.
- **Separate STR-03 candidate queued:** the six replacement leaves still differ in this clone. Per coordinator, that root cause has a separately validated candidate queued for publication; this repair neither bundles it nor claims those six leaves fixed locally.
- Existing checkpoint controls passing and exact pre/post original-output equality do not waive any of these observations. Fresh independent validation is required for this repaired candidate and again after combined changes.

### Frozen validator history integrity

All **28 validator-owned files** were byte-count/SHA-256 checked before and after repair. Their assertions, initial manifests, amended report, clarification manifest, full failure outputs, base results and checkpoint witness records remain unchanged. Historical NOT READY was not rewritten into READY. The ordered integrity-record array has SHA-256 `08bef87b50e4771054cd362e8738a6d0c1b4a6f7f492a3e201258fef05560c62` (JSON.stringify array, UTF-8, no trailing newline).

| Preserved validator path                                                                        |  Bytes | SHA-256                                                            |
| ----------------------------------------------------------------------------------------------- | -----: | ------------------------------------------------------------------ |
| `packages/safejs/src/metadata-validation.test.ts`                                               |   6362 | `1c645d808957f96bd02092329fdee0f62b2c17c57b6fa4ee9c9bc98f022ca273` |
| `docs/plans/safejs-validate-array-own-metadata.md`                                              |  21650 | `6a575a8727a6f8cbc17e22c8b7201be6f02595b6ea8ddf046ecf0db8336173cc` |
| `out/safejs-remediation/array-own-metadata-validation/archive-guard.json`                       |   9324 | `25f7566e92de3e2d9fea9c6a8a83910d9ede1e705bbfbab42437aefd5f227551` |
| `out/safejs-remediation/array-own-metadata-validation/broad-relevant.json`                      |   4323 | `8f2b4f0ff81b6c54afafb2cc99e931a8f9d33002a295ccd4c000537f589cc591` |
| `out/safejs-remediation/array-own-metadata-validation/checkpoint-base-control.json`             |   3513 | `53f91c9c9d708ea7268e244f2af0018646ea24f42b55b79812bea3fbce0d6726` |
| `out/safejs-remediation/array-own-metadata-validation/checkpoint-existing-controls.json`        |   5234 | `7cbf03b60ff02cd8e88505c2eaf4e1cd2033b9cd0d9eb12110b0c79b3dcb3c4c` |
| `out/safejs-remediation/array-own-metadata-validation/checkpoint-metadata-control.json`         |   2594 | `fcde6a65e6ee75cd71b59c318d4c249caac192ae9354816930ba02773193a46e` |
| `out/safejs-remediation/array-own-metadata-validation/commands.json`                            | 285047 | `0649b677436a1d21254522a59cb35afb682094e7e63764c12635df68b944df3a` |
| `out/safejs-remediation/array-own-metadata-validation/diff-check.json`                          |    209 | `6e4d216591f9827522670aed538824ddf1cccb8c64f0d7589c174ececd2be9aa` |
| `out/safejs-remediation/array-own-metadata-validation/final-diff-check.json`                    |    215 | `fe6d8debababd9fbf015339993f6630ebe06ef04d863dabc77186eff91f7460b` |
| `out/safejs-remediation/array-own-metadata-validation/focused-current.json`                     |   7133 | `c5dcfb184b7f926f1bb315f154b92e986ec429e6be0ab0f7d6f5779139f09670` |
| `out/safejs-remediation/array-own-metadata-validation/format.json`                              |    610 | `c67dc3feda881b71926ea923f4ddebaa8463b37825f4ccd6edfa5ac58bfb9951` |
| `out/safejs-remediation/array-own-metadata-validation/handoff-clarification-manifest.json`      |   4721 | `9ddd6af1263ace5d4dd578a45afc93044f6c5fc1b047412cebbb04d57c3c96e8` |
| `out/safejs-remediation/array-own-metadata-validation/handoff-clarification.json`               |   4054 | `e7cdd9ede635e8d21745ae62f534595620dc3391749860925c1f18755172c4c6` |
| `out/safejs-remediation/array-own-metadata-validation/legacy-test-types.json`                   |  69658 | `9d8b68ccdc824e260d71069b449102eb1cb8108a8071fbf83402dbb391b019d6` |
| `out/safejs-remediation/array-own-metadata-validation/legacy-types-comparison-corrected.json`   |  77763 | `85be22236ed6e4abf97f8dee32dcb3a1ac7f92a00d2963c2a8625b4b35e2bb0a` |
| `out/safejs-remediation/array-own-metadata-validation/legacy-types-comparison-line-column.json` |  82366 | `22e3e2646a2193e70cf90cf4440afb3ab428f57b9d0f36dd6a507da56479cb95` |
| `out/safejs-remediation/array-own-metadata-validation/legacy-types-comparison.json`             |   5061 | `a62a1000795dac3e3c4f402a2ac68503b39d56049ad089d75f7f08aac36e13a9` |
| `out/safejs-remediation/array-own-metadata-validation/lint.json`                                |    524 | `417b0a422e66e81a27a483647e06c55cb671b11a8dff633afc34447ceb6a2020` |
| `out/safejs-remediation/array-own-metadata-validation/noncallable-array-object-controls.json`   |   5377 | `e19d9aaf31c11c2f35c78f4baa25738c63a2d1582090bb76a4281c728d4b44ca` |
| `out/safejs-remediation/array-own-metadata-validation/noncallable-base-controls.json`           |   6422 | `384e85ea1914e6bc8679989832a386d34eb906960b92f298790c0f7a05dc9f37` |
| `out/safejs-remediation/array-own-metadata-validation/original-executions.json`                 |   5257 | `09eeb76afb925e0472c09f1250b379cf467d5eb9b0ffffd21b3eb618b78771a5` |
| `out/safejs-remediation/array-own-metadata-validation/original-expected-actual.json`            |  56125 | `97ae80d7e5213923d398543ef732bbf26e7730e74b6af4ec72bb2a90f86053aa` |
| `out/safejs-remediation/array-own-metadata-validation/source-types.json`                        |    269 | `0b4aacb1606fb688b2ee758e5d6bc1c533366c742fbb00645a70bc79004211eb` |
| `out/safejs-remediation/array-own-metadata-validation/summary.json`                             |  14188 | `62a6fe7980ab925c4997f3929db51a994a97a729d15186fb9a19dc08749cb499` |
| `out/safejs-remediation/array-own-metadata-validation/test-types.json`                          |    556 | `88e0917db744e5162a5a3f00983d5296e29e8ebf2e724618eea33b6364162420` |
| `out/safejs-remediation/array-own-metadata-validation/validation-manifest.json`                 |   8802 | `9d84e8e38391edca6915f30b353a289f68ea3b38c6a544f621678ae4547b0b41` |
| `out/safejs-remediation/array-own-metadata-validation/validator-base-red.json`                  |  12551 | `9f98993b1489610b5d5149427c9a7badfe2bcea5c75b8d8c185b0d1b82e27a3c` |

### Current author code fingerprints

These supersede the historical author-code fingerprints only where changed. The plan's final hash is supplied in the handoff rather than embedded in itself. No independent READY verdict or publication authorization is implied.

| Author code/test path                                | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/interpreter.ts`          | `52f4a7a3e17d3953b3d300c75c84ab62cc52e6745e9d74ceeb04872e98bf61b8` |
| `packages/safejs/src/interp/interpreter.test.ts`     | `adb1281d5707db96163f9b938f3ee6bff180d1e53ee2aa3574c20c49b6f8df7f` |
| `packages/safejs/src/interp/methods/array.ts`        | `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba` |
| `packages/safejs/src/interp/methods/array.test.ts`   | `5dff8d15e5391378d2258829f1a3a161426d75ed9e8c5f8cedae79d988d7745d` |
| `packages/safejs/src/run.array-own-metadata.test.ts` | `b69b551247c0af31529bfe4ce2623f394e83cc4615373d2495e32f7ad4e2fa37` |
| `packages/safejs/src/run.call-order.test.ts`         | `d8eeb1b215e5e45eace669f50280e51d77520214bce82ca98ff6ea471018db4b` |

### Focused failure and success logs

The original validator evidence remains immutable; these are newly captured author repair runs. ANSI styling is stripped without changing result text.

#### Frozen focused RED

```text
RUN  v3.2.6 /Users/kjopek/Workspace/poe-code-safejs-array-metadata

 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'reads stored bounds without losing ow…' 18ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'preserves metadata reference identity…' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'distinguishes absent, undefined, and …' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'keeps non-index numeric names separat…' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'calls and extracts an own matcher use…' 4ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'preserves the receiver when calling o…' 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'reads ordinary raw metadata while pre…' 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'lets own callable methods shadow buil…' 4ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'does not invoke a built-in hidden by …' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from /a(b)/.exec(input) 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from input.match(/a(b)/) 2ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from Array.from(input.matchAll(/a(b)/g))[0] 2ms
 × packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own undefined fields and rejects their invocation without falling back 31ms
   → expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)
 × packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own null fields and rejects their invocation without falling back 7ms
   → expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)
 × packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own false fields and rejects their invocation without falling back 8ms
   → expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)
 × packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own 0 fields and rejects their invocation without falling back 5ms
   → expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)
 × packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own "" fields and rejects their invocation without falling back 5ms
   → expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'evaluates computed own calls once in …' 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves direct receivers and extrac…' 3ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves live custom metadata aliase…' 6ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'distinguishes ordinary raw callbacks …' 5ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'shadows built-ins with registered nat…' 3ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves noncanonical numeric metada…' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'keeps supported array methods intact …' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'reads assigned fields through destruc…' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > preserves an own async method receiver across an ordinary await 3ms

 Test Files  1 failed | 1 passed (2)
      Tests  5 failed | 21 passed (26)
   Start at  23:35:14
   Duration  708ms (transform 395ms, setup 65ms, collect 778ms, tests 145ms, environment 0ms, prepare 99ms)


⎯⎯⎯⎯⎯⎯⎯ Failed Tests 5 ⎯⎯⎯⎯⎯⎯⎯

 FAIL  packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own undefined fields and rejects their invocation without falling back
 FAIL  packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own null fields and rejects their invocation without falling back
 FAIL  packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own false fields and rejects their invocation without falling back
 FAIL  packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own 0 fields and rejects their invocation without falling back
 FAIL  packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own "" fields and rejects their invocation without falling back
AssertionError: expected { ok: true, …(3) } to match object { ok: true, returnValue: [ …(3) ] }
(12 matching properties omitted from actual)

- Expected
+ Received

@@ -4,11 +4,10 @@
      [
        true,
        undefined,
        undefined,
        [
-         "argument",
          "TypeError",
        ],
      ],
      [
        5,

 ❯ packages/safejs/src/metadata-validation.test.ts:29:7
     27|       expect(native[0][3]).toEqual(expectedTrace);
     28|       expect(native[1]).toEqual([5, 8]);
     29|       await expect(run(source, { modules: {} })).resolves.toMatchObjec…
       |       ^
     30|         ok: true,
     31|         returnValue: native

⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯⎯[1/5]⎯
```

#### Frozen focused GREEN

```text
RUN  v3.2.6 /Users/kjopek/Workspace/poe-code-safejs-array-metadata

 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'reads stored bounds without losing ow…' 14ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'preserves metadata reference identity…' 4ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'distinguishes absent, undefined, and …' 4ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'keeps non-index numeric names separat…' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'calls and extracts an own matcher use…' 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'preserves the receiver when calling o…' 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'reads ordinary raw metadata while pre…' 2ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'lets own callable methods shadow buil…' 2ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > 'does not invoke a built-in hidden by …' 5ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from /a(b)/.exec(input) 3ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from input.match(/a(b)/) 2ms
 ✓ packages/safejs/src/run.array-own-metadata.test.ts > array own metadata > reads native match metadata from Array.from(input.matchAll(/a(b)/g))[0] 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own undefined fields and rejects their invocation without falling back 18ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own null fields and rejects their invocation without falling back 6ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own false fields and rejects their invocation without falling back 6ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own 0 fields and rejects their invocation without falling back 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > keeps own "" fields and rejects their invocation without falling back 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'evaluates computed own calls once in …' 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves direct receivers and extrac…' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves live custom metadata aliase…' 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'distinguishes ordinary raw callbacks …' 4ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'shadows built-ins with registered nat…' 3ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'preserves noncanonical numeric metada…' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'keeps supported array methods intact …' 3ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > 'reads assigned fields through destruc…' 2ms
 ✓ packages/safejs/src/metadata-validation.test.ts > independent array own metadata validation > preserves an own async method receiver across an ordinary await 3ms

 Test Files  2 passed (2)
      Tests  26 passed (26)
   Start at  23:37:39
   Duration  653ms (transform 368ms, setup 104ms, collect 693ms, tests 117ms, environment 0ms, prepare 101ms)
```

## Current-main integration evidence

Observed 2026-08-29T01:09:49-0500. **Author-integrated candidate ready for separate independent integration validation; not independently approved for publication.** This section is appended to the exact captured author plan. Everything before it, including historical failures and earlier qualifications, remains byte-identical to the approved input capture. The copied validator report and all captured test assertions remain unchanged. No master plan or other lane's report is edited.

### Workspace and provenance

- New isolated workspace: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata-integrated`.
- Cloned `https://github.com/poe-platform/poe-code.git` with `--single-branch --branch main`; origin resolves to `git@github.com:poe-platform/poe-code.git`. No publisher or OBJ workspace was inspected.
- Successful `git -c pull.rebase=false pull --ff-only` was the first command in the new clone, before installation or implementation work. It returned already up to date; initial worktree was clean.
- Pinned current-main base: `9ed57df23ff62f4d2eeffd6cf0753cc95624424b`. This is the successful-pull base, not a claim about later remote movement.
- Validated incoming manifest: `/Users/kjopek/Workspace/poe-code-safejs-array-metadata/out/safejs-remediation/array-own-metadata-validation/revalidation-call-order/candidate-051cfa0474bd5d62/manifest.json`, SHA-256 `051cfa0474bd5d627bf1589b0b4fada3295782a3e653d76199992055361837ae`. Its original base is `bc85287c08cfa8796af80c76d0dd8dd2ddf7347b`.
- Verified all nine listed publishable files and all four original base preimages against captured byte lengths and SHA-256. The input capture and original ARRAYOWN workspace were only read at explicitly manifest-listed capture paths; no writes or permission changes occurred there.
- Read ancestor and clone-root AGENTS instructions; no nested AGENTS file was found. Installed locked dependencies with `SKIP_SYNC_SKILLS=1 env -u TERM npm ci`: exit 0, 548 added / 619 audited. Existing deprecation and 10-vulnerability notices were not remediated in this task.

### Exact overlaps and merge method

Four tracked paths use the captured original preimage, pinned main preimage, and validated candidate as the three merge inputs. All four `git merge-file -p --diff3` computations returned exit 0 without conflict markers. The command printed merge results only; it did not mutate Git state or captured inputs. Production and existing tests were updated with minimal apply_patch hunks, never by replacing the interpreter with the old captured file. New tests and reports were added with their exact captured bytes.

| Tracked path                                       | Main differs from old base | Clean three-way result | Result equals incoming capture |
| -------------------------------------------------- | -------------------------- | ---------------------- | ------------------------------ |
| `packages/safejs/src/interp/interpreter.ts`        | true                       | exit 0                 | false                          |
| `packages/safejs/src/interp/interpreter.test.ts`   | false                      | exit 0                 | true                           |
| `packages/safejs/src/interp/methods/array.ts`      | false                      | exit 0                 | true                           |
| `packages/safejs/src/interp/methods/array.test.ts` | false                      | exit 0                 | true                           |

Only `packages/safejs/src/interp/interpreter.ts` overlaps files changed on main since the incoming base. Main's changes are the COLL-001 restorable-collection graph and for-of snapshot/cursor work, around lines 1132–1920 of the old/current contexts. ARRAYOWN's four current-main interpreter hunks begin at lines 2602, 2634, 3259 and 3322. The hunk regions are disjoint. AST-extracted bodies of `isRestorableBindingValue`, `evaluateForOfStatement`, `evaluateForOfIterator`, `createLoopIterationContext`, and `snapshotableIterationValues` compare byte-for-byte equal before/after integration. The main iteration.ts cursor fix remains untouched.

Published commits present at the pinned base:

- COLL-001/cursor: `f685e08b`.
- MC-003 Number constants: `a962264d`.
- MC-001 nonfinite known globals: `b7dfa471`.
- STR-03 replacement semantics: `33c73a21`.
- TREE-01 contextual from: `9ed57df2`.
- No HI-specific commit is present in the observed interval; HI inclusion is not claimed.

**OBJ001 overlap:** none of the nine candidate publishables is a globals file. The described parallel `packages/safejs/src/interp/globals/object-array.ts` work therefore has no file-level overlap with this captured ARRAYOWN patch. Current main's MC-003 changes to that file are preserved. No OBJ001 clone or unpublished patch was read, so this is not certification of a combined ARRAYOWN/OBJ001 runtime. If another lane changes interpreter.ts or other listed paths later, repeat the merge and independent validation.

No semantic conflict repair, new production fix, assertion change, or test weakening was needed. The first in-memory merge-preparation attempt rejected a null path for an absent preimage before any edits; the corrected preparation explicitly branches on the manifest's exists flag. This was a helper error, not a merge conflict or runtime verdict.

### Current-base RED and integrated GREEN

The three new captured regression files were installed first with exact SHA-256 matching. All four existing candidate paths still matched pinned-main preimages when RED ran.

- Current-main RED: frozen author ARRAYOWN, validator, and generic call-order tests together: **39 failed, 2 passed / 41**, three files, exit 1, 1.06 seconds. This is a new current-base proof, not the old base's recorded failure history.
- Integrated combined GREEN: **41 passed / 41**, exit 0, 998 ms.
- Separately rerun final gates: original **26/26** author+validator checks and required **15/15** generic call-order checks, both exit 0. The incoming 13-RED-to-15-GREEN generic history is preserved in the captured plan.
- Published COLL-001 author+validator suites: **136/136**, two files, exit 0, 2.18 seconds; includes the iteration cursor fixes.
- Published MC-003, MC-001, STR-03, TREE-01 author+validator pairs: **380/380**, eight files, exit 0, 3.07 seconds.
- Combined scoped suite: **1226 passed, 0 failed, 9 intentionally filtered / 1235**, 21 files, exit 0.

Every runtime/build/check command uses `env -u TERM`. The final combined command is retained exactly in the ignored evidence. It includes the frozen 26+15 tests, reference and promise-order suites, interpreter/method suites, COLL-001 pairs and all eight published regression files. The nine exclusions retain the prior security/prototype-focused boundary. An initial broad selection passed 1225 and filtered 10 because its dot-based regex also omitted one multiline TREE case; that case passed in the separate 380-case run. The final selector uses [\s\S] to include multiline names: 1226 pass, exactly nine intended exclusions. Both attempts are retained in evidence.

This is scoped functional verification, not a whole-repository/adversarial or whole-original-fixture certification. No original audit payload was needed or read, and no security/prototype probe campaign was run. No new host capabilities, actual LLM calls, or guest filesystem/network/process access were introduced.

### Build, configured checks and artifact scope

- Narrow dependency build with env -u TERM and agent-spawn/frontmatter/tiny-mcp-client filters: **21/21 build tasks**, exit 0, 11.094 seconds.
- `env -u TERM npm run build`: **67/67 tasks**, exit 0; completed plan/harness schema generation, root TypeScript compilation and bundling. Turbo task duration 34.146 seconds.
- `env -u TERM npm run lint:types`: PASS, configured root tsc gate, exit 0.
- `env -u TERM npm run lint:eslint`: PASS, configured repository ESLint gate, exit 0.
- `env -u TERM npm run lint:packages`: PASS, all 17 rules across 68 packages, exit 0.
- SafeJS package source typecheck: PASS. Scoped test typecheck over the three new captured tests plus methods/array.test.ts: PASS. No unconfigured legacy interpreter-test typing claim is added.
- Prettier check on all seven code/test publishables: PASS. Validator report bytes are preserved, not reformatted. The integration appendix alone is formatted before appending to the historical author plan.
- `git diff --check`: PASS. No user-facing CLI visual output changed, so screenshots were not needed.
- The build generated four untracked terminal-pilot font files, listed below. These are build artifacts, not publishables; they are left untouched and excluded from the integration capture. No tracked generated workflow/schema change remains.

- `packages/terminal-pilot/assets/jetbrains-mono-400-italic.ttf`
- `packages/terminal-pilot/assets/jetbrains-mono-400-normal.ttf`
- `packages/terminal-pilot/assets/jetbrains-mono-700-italic.ttf`
- `packages/terminal-pilot/assets/jetbrains-mono-700-normal.ttf`

### Qualification and dedicated-lane boundaries

- Named-array checkpoint metadata/raw loss is addressed by the **separate OBJ002 fix**, not by this capture and not present in the pinned-main changes inspected here. No serializer hunk is included and no named-metadata checkpoint parity is claimed. Combined OBJ002 validation belongs to its integration lane.
- Regex metadata own-key ordering remains **PENDING**, with the historical nine differing leaves retained; no regex-key-order production code is modified.
- Enumerable host-getter bookkeeping differences remain **PENDING**; the incoming low-level observations are not waived or broadened into a host-accessor parity claim.
- STR-03 is now present on this pinned main and its published regression pair passes. The old plan's six original-workflow replacement differences describe its historical older base; those exact historical workflows were not rerun here, so no blanket whole-fixture PASS or new full-output count is asserted.
- The copied validator READY verdict applies to its original captured bytes. This merged interpreter has a new hash and requires the separate independent integration validator before publication.

### Freeze and handoff

Only the nine manifest-listed publishables are frozen under `out/safejs-remediation/array-own-integration/files/`; four current-main preimages are frozen under `base/`, with explicit absence for the five added paths. The original source manifest, merge/hunk evidence, complete RED/GREEN logs, final broad JSON and check results are retained there too. A local self-ignored `.gitignore` containing \* makes this artifact directory ignored without changing repository ignore rules or Git metadata. Final capture files are mode 0444 and directories 0555.

The integration manifest names all paths, hashes, byte lengths, original/current base identities, qualifications and independent-revalidation requirement. Its hash is supplied in the handoff rather than embedded in this plan. No commit, push, feature branch, master-plan edit, source-capture modification, or root-goal completion occurred. The working tree's nine publishables and frozen copies must match before another agent validates or integrates them.

Current non-plan publishable fingerprints:

| Publishable path                                     | SHA-256                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/interpreter.ts`          | `50175cb793ecf85ce80cf0e7f0d2667680090eed8c70c20c1f9158e6cab8cbdb` |
| `packages/safejs/src/interp/interpreter.test.ts`     | `adb1281d5707db96163f9b938f3ee6bff180d1e53ee2aa3574c20c49b6f8df7f` |
| `packages/safejs/src/interp/methods/array.ts`        | `6de97e76745d9bac348957c78717c7dda4766385ce004f92ce49d71202e874ba` |
| `packages/safejs/src/interp/methods/array.test.ts`   | `5dff8d15e5391378d2258829f1a3a161426d75ed9e8c5f8cedae79d988d7745d` |
| `packages/safejs/src/run.array-own-metadata.test.ts` | `b69b551247c0af31529bfe4ce2623f394e83cc4615373d2495e32f7ad4e2fa37` |
| `packages/safejs/src/run.call-order.test.ts`         | `d8eeb1b215e5e45eace669f50280e51d77520214bce82ca98ff6ea471018db4b` |
| `packages/safejs/src/metadata-validation.test.ts`    | `1c645d808957f96bd02092329fdee0f62b2c17c57b6fa4ee9c9bc98f022ca273` |
| `docs/plans/safejs-validate-array-own-metadata.md`   | `6a575a8727a6f8cbc17e22c8b7201be6f02595b6ea8ddf046ecf0db8336173cc` |
