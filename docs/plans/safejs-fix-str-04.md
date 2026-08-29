# STR-04: RegExp cursor state

## Assignment and isolation

- Delegated implementation worker; no nested delegation or publication.
- Owned clone: `/Users/kjopek/Workspace/poe-code-safejs-regex-cursor`.
- Cloned `main` with `--single-branch --branch main`; first repository operation after clone was successful `git -c pull.rebase=false pull --ff-only` (`Already up to date.`).
- Base: `a962264d3ec5f40c91f4e1a1bc15f3148fff3091`; initial status clean.
- Read `/Users/kjopek/Workspace/AGENTS.md` and clone-root `AGENTS.md`; no deeper instructions in packages/docs.
- No branch, stash, reset, staging, commit, push, README edits, inline code comments, or QA executable files.

## Scope

Repair ordinary bounded cursor workflows through the existing supported regex/string methods. `exec`/`test` consume the global receiver cursor, global `match`/replacement reset and consume it, `search` preserves it, `matchAll` copies it, and `split` uses an independent scan from zero. Existing flags are `g`, `i`, `m`, `s`; `y` and `gy` are rejected by the parser, so sticky support is not added. Keep zero-width advancement confined to repeated string scans, not `exec`/`test`.

STR-02 no-match result shape, STR-03 replacement tokens, STR-05 split captures, and regex metadata key order remain separate. No resource/security probes, guest real I/O, LLM use, or filesystem fixtures. Tests import current TypeScript, not SafeJS dist.

## Audit access

The audit is read-only. Bootstrap metadata: `inventory.json`, including its exact 38 `archiveReadPolicy.excludedPaths`, plus the entire `security/` directory excluded before case access. A guarded in-memory allowlist permits only root `REPORT.md`, `strings/REPORT.md`, `strings/results.json` (case 20 only), and `strings/reductions/r05-global-lastindex.safejs`. No directory/family content searches or archived payload reads/hashes/execution.

Access qualification: initial metadata-schema inspection also parsed `inventory-verification.json`, `snippet-ledger-verification.json`, and `audit-index-state-20260828T000802Z.json` before the explicit exclusion guard was installed. These were metadata-only, not archived payloads. Report excerpt selection displayed neighboring headings and the STR-05 report paragraph; no neighboring reproductions/expectations were opened. Subsequent original-case reads use the explicit allowlist.

Original source SHA-256 inherited from case metadata and confirmed from the allowlisted source: `ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d`. SHA-256 of `JSON.stringify(excludedPaths)` in metadata order: `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`. No excluded artifact content was read or hashed.

## Setup

Followed `/Users/kjopek/Workspace/poe-code-safejs-fixes/out/safejs-remediation/setup/report.md`:

- Node `v22.22.2`, npm `10.9.7`.
- `SKIP_SYNC_SKILLS=1 npm ci`: exit 0, 548 packages; lifecycle hooks enabled, skill sync skipped. Existing install report: 10 vulnerabilities; no dependency changes.
- `./node_modules/.bin/turbo run build --filter=@poe-code/agent-spawn --filter=@poe-code/frontmatter --filter=tiny-mcp-client --output-logs=errors-only`: exit 0, 21/21 tasks.

## TDD sequence

1. Establish native original output before interpreter execution.
2. Add exact original workflow and operation/cursor/callback regression tests.
3. Record actual RED, repair shared collection state, record GREEN.
4. Validate relevant broader tests, types, lint, formatting; remove `TERM` for full terminal-sensitive gates.
5. Capture exact owned-path preimage/final hashes and hand off for independent validation, not publication.

## Native original output

```json
{
  "all": ["a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 0,
  "replaced": "XbX",
  "afterReplace": 0
}
```

## Preimages

SHA-256 at base:

| Path                                                      | Preimage                                                           |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/string.ts`            | `0dd53f36441b5b3edbccb5b25115b74d036e22c254313449d55871d7f4664d84` |
| `packages/safejs/src/interp/methods/regex-cursor.test.ts` | absent                                                             |
| `docs/plans/safejs-fix-str-04.md`                         | absent                                                             |

Unchanged reference hashes: `regex.ts` = `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1`; `regex/engine.ts` = `b12b0efa3760b5395a13474d0ce7313f063e2978cdb0e7a97f6e581bd6613118`; `regex/parse.ts` = `86d0c5fa8a8269e5eb40aaccae36160dd09f51358e0f619ac9e4335aa0617e15`.

Root manifest = `a3e5638abe5f1df44298e105db2a25c93ad6d0d26ef1d8ab2f93cfa466f11b99`; lock = `297af2f85db1eeedaca7a33f64a4ec95bed39754d42a1e787a236c4af55c29c7`.

## Implementation

Only `packages/safejs/src/interp/methods/string.ts` changes production behavior. The shared collector previously bypassed `executeRegex`, always starting its private scan at zero and never updating the receiver. It now uses the existing stateful execution primitive:

- Global `match`, `replace`, and `replaceAll` reset before collecting; the final unsuccessful execution resets the receiver to zero. Non-global replacement still preserves the receiver.
- `matchAll` uses a distinct regex carrying the original cursor. Later receiver writes cannot change the copied scan.
- `split` uses a distinct global scan from zero, preserving the original receiver for global and non-global separators. Its existing capture/limit result construction is not changed.
- Only repeated string scans advance zero-width matches by one supported code unit. `exec`/`test` retain their existing zero-width positions.
- Replacement scans finish before invoking callbacks. Callback cursor writes and exceptions are preserved; no blanket reset runs after callbacks.
- `search`, `exec`, `test`, parser flags, regex metadata, and replacement-token expansion have no production edits.

Native Node anchors are primary executable evidence. The published ECMAScript 2024 text-processing algorithms were also consulted: RegExp `@@match`, `@@matchAll`, `@@replace`, `@@search`, `@@split`, and `RegExpBuiltinExec`. No implementation feature beyond the existing supported subset is inferred from them.

## Actual RED and GREEN

Observed August 29, 2026 UTC (August 28 in Chicago).

- RED command: `./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-cursor.test.ts --reporter=dot`.
- RED exit 1: **103 failed, 309 passed, 412 total**; 813 ms total, 127 ms tests. Production was unchanged. Native original anchor passed before the interpreter assertion failed. Log: `out/safejs-remediation/str-04/red.log`.
- GREEN same command after the production patch: exit 0, **412 passed**; 869 ms total, 109 ms tests. Log: `out/safejs-remediation/str-04/green.log`.
- The new tests comprise 392 bounded operation/flag/cursor combinations plus the exact original workflow, failed scans followed by exec, zero-width scans, callback observations/mutations/exceptions, copied matchAll state, split limits, and explicit rejection of unsupported sticky flags.
- Native expectations are computed before each interpreter invocation. Raw match arrays are compared without metadata in the operation matrix; no new metadata key-order observation is introduced.

### Original full return values

Native, established first:

```json
{
  "all": ["a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 0,
  "replaced": "XbX",
  "afterReplace": 0
}
```

Current TypeScript before the fix (`ok: true`, `nodeVisits: 52`):

```json
{
  "all": ["a", "a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 2,
  "replaced": "XbX",
  "afterReplace": 2
}
```

Current TypeScript after the fix (`ok: true`, `nodeVisits: 49`):

```json
{
  "all": ["a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 0,
  "replaced": "XbX",
  "afterReplace": 0
}
```

These are complete return values, not just the fields that differed. Snapshot envelopes are not treated as native output. Both before/after runs imported `packages/safejs/src/run.ts` through `node --import tsx`, not dist.

### Original cursor timeline

| Step                         | Native       | Before         | After        |
| ---------------------------- | ------------ | -------------- | ------------ |
| Assign `lastIndex = 2`       | 2            | 2              | 2            |
| Fully consume `aba.matchAll` | 2, one match | 2, two matches | 2, one match |
| Global `aba.match`           | 0            | 2              | 0            |
| Assign `lastIndex = 2` again | 2            | 2              | 2            |
| Global `aba.replace`         | 0            | 2              | 0            |

### Qualified no-match workflow

An additional ordinary workflow sets `/z/g.lastIndex = 2`, runs `aba.match`, then executes against `z`. Its cursor behavior is fixed, but its full output still differs due to queued STR-02:

Native:

```json
{ "matched": null, "afterMatch": 0, "next": "z", "afterExec": 1 }
```

Current TypeScript after this fix:

```json
{ "matched": [], "afterMatch": 0, "next": "z", "afterExec": 1 }
```

The no-match regression tests deliberately assert the cursor/subsequent-exec workflow, not equivalence of the omitted match result. STR-03 replacement-token behavior and STR-05 undefined split captures remain untouched and are not certified here. The original STR-04 workflow itself now has complete return-value parity.

## Validation

| Command                                                                                                                                                                         | Actual outcome                                                                                                   |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals/misc.test.ts --reporter=dot` | Exit 0; 9 files, **535 passed**, 1.46 s total, 237 ms tests; includes formatted new tests and 123 existing tests |
| `env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit`                                                                                                 | Exit 0                                                                                                           |
| `env -u TERM npm run lint:eslint`                                                                                                                                               | Exit 0, full repository ESLint                                                                                   |
| `env -u TERM npm run lint:packages` before full build                                                                                                                           | Exit 1; seven missing built runtime assets, no source fix attempted                                              |
| `env -u TERM npm run build`                                                                                                                                                     | Exit 0; **67/67** Turbo tasks, 25.916 s Turbo phase; schema generation, root compile and bundle passed           |
| `env -u TERM npm run lint:packages` after full build                                                                                                                            | Exit 0; all **17 rules**, **68 packages**, including bundle checks                                               |
| `env -u TERM npm run lint:types`                                                                                                                                                | Exit 0, root TypeScript                                                                                          |

Logs are under `out/safejs-remediation/str-04/` and are local evidence, not issue patch paths. `red.log` was initially redirected to `/tmp/str-04-red.log`, then moved into this clone; no scratch evidence remains at that temporary path. Standard relevant existing unit tests ran; no new security/resource probes, archived workloads, adversarial suite, full repository tests, or slow fuzz jobs ran. Screenshot validation is not applicable: no CLI presentation code changed.

## Final manifest and handoff

Final `prettier --check` on all three owned paths and `git diff --check` both pass. Formatting edits were applied through `apply_patch`, not direct formatter writes.

Owned patch paths only:

| Path                                                      | Base/preimage                                                      | Final SHA-256                                                                                   |
| --------------------------------------------------------- | ------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- |
| `packages/safejs/src/interp/methods/string.ts`            | `0dd53f36441b5b3edbccb5b25115b74d036e22c254313449d55871d7f4664d84` | `1501078eb9ddba91c703659a801b21202e9c050352b82666102c8786566c29a3`                              |
| `packages/safejs/src/interp/methods/regex-cursor.test.ts` | absent                                                             | `cc5dad2313bd152615e255b72b8064a72c77f142cd3d055f84b1ad0ee20e8f19`                              |
| `docs/plans/safejs-fix-str-04.md`                         | absent                                                             | Recorded externally in `out/safejs-remediation/str-04/manifest.json` to avoid a self-hash cycle |

The external manifest records absolute paths, base SHA, preimage Git blob/SHA-256, postimage SHA-256, and the final plan hash. It is local handoff evidence, not an additional patch path.

Risks and exclusions:

- STR-03 is independently publishing and can overlap `string.ts`. Apply this issue by three-way merge against the recorded base; never copy the whole file over the independently approved candidate. Independently validate the merged result and rerun cursor/replacement suites.
- This clone remains on the original base `a962264d3ec5f40c91f4e1a1bc15f3148fff3091`; no later pull or claim about current upstream state is made.
- Sticky (`y`/`gy`), Unicode regex flags, non-finite/huge cursor values, and exotic cursor coercions remain outside this work. Finite negative, positive, fractional, end-of-input and just-past-end cursors are covered. Creating private scans reparses the existing supported pattern; no performance claim is made.
- Full build generated four untracked `packages/terminal-pilot/assets/jetbrains-mono-{400,700}-{italic,normal}.ttf` copies. They are not owned issue changes and must not enter the handoff patch. They were not removed or modified manually. Root manifest/lock and unchanged regex implementation hashes remain identical to the preimages.
- The local `out/` logs are also untracked, not ignored. Use the three explicit patch paths only; never stage or copy broad directories.
- Independent validation is still required. No release, publication approval, or overall remediation-goal completion is claimed.

## Integration author update — August 29, 2026

This appendix records a new integration-author task. All preceding author evidence is retained byte-for-byte as historical context; the incoming independent validator report is also retained unchanged. Neither its old blocker verdict nor the historical author's pre-STR03 base is rewritten. Fresh independent validation of this new candidate is still required.

### Isolated base and inputs

- New clone: `/Users/kjopek/Workspace/poe-code-safejs-regex-cursor-integrated`.
- Origin read from the publisher: `git@github.com:poe-platform/poe-code.git`. Created with `--single-branch --branch main`.
- First repository operation after clone: successful `git -c pull.rebase=false pull --ff-only` (`Already up to date.`). Initial worktree clean.
- Current base is exactly `7fec2826bac2933483c2579ff47d2264f8e1f422`; `git merge-base --is-ancestor 7fec2826bac2933483c2579ff47d2264f8e1f422 HEAD` exits 0. ARRAYOWN is therefore included, not transplanted from an unpublished clone.
- Read workspace-parent/root AGENTS; no deeper package/docs instructions found. Direct delegated work; no nested delegation.
- Incoming author manifest SHA-256: `35658d261bd346fca5d63ed514cead5f6a4489999c7345cef5b88c20dde9fbd7`.
- Incoming Gödel manifest SHA-256, checked against the assignment: `fd5a5e8271afcb96478af1204c20c794371c2b3f550cea8327f7477f0bf5b117`.
- All five incoming file hashes and the historical 1,027-case JSON result hash were verified before use. Both cursor suites and the validator report were transferred with `apply_patch` and remain byte-identical to their manifests.
- Pinned setup: `SKIP_SYNC_SKILLS=1 npm ci` succeeds (548 packages, 619 audited); the explicit agent-spawn/frontmatter/tiny-mcp-client dependency build succeeds, 21/21 tasks, 10.824 seconds. No dependency edits/global skill sync. The install's existing 10-vulnerability report is not investigated or modified.
- Evidence is locally ignored using `.git/info/exclude`: `/out/safejs-remediation/str-04-integration/`.
- User reports ARRAYOWN CI pending. This task does not inspect or certify CI/release status and performs no publication action.

### Original audit boundary

Before the sole original payload read, bootstrap `inventory-verification.json` metadata (SHA-256 `2ff2b353edf16714ee705dd550903a11bae70e1d7a544357de81d540b13ff827`) supplied all 38 exact excluded paths; the whole `security/` directory was also denied. The only payload allowlisted/read was `strings/reductions/r05-global-lastindex.safejs`, SHA-256 `ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d`. No recursive audit/family search or excluded read/hash/execution occurred. New guard details are in `audit-read-policy.json`. Original regex-cursor and regex-metadata-order clones/captures remain read-only; no regex-metadata-order candidate bytes were imported.

### Genuine current-base RED and integrated GREEN

Both runs use the exact incoming files and the actual current TypeScript working tree, not a preimage transform or dist:

```sh
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-cursor.test.ts packages/safejs/src/interp/methods/regex-cursor.independent.test.ts --reporter=dot --reporter=json --outputFile=<evidence-results.json>
```

| Suite                  | Current ARRAYOWN base RED                 | Merged GREEN                               |
| ---------------------- | ----------------------------------------- | ------------------------------------------ |
| Unchanged author suite | 103 failed / 309 passed / 412 total       | 412 passed                                 |
| Unchanged Gödel suite  | 373 failed / 654 passed / 1,027 total     | 1,027 passed                               |
| Combined               | **476 failed / 963 passed / 1,439 total** | **1,439 passed, zero failed/skipped/todo** |

RED exits 1 (1.76 s total, 1.21 s tests). GREEN exits 0 (1.36 s total, 885 ms tests). `current-base-red-results.json` and `merged-green-results.json` retain every test result.

The historical candidate's **118 failed full-result cases are matched by exact full test identity** against this run. All 118 now pass, without any assertion edit, skip, expected-failure marking, output erasure, or metadata normalization. On current main before adding the cursor change, 76 of those cases already pass and 42 still fail; all 118 pass with the composed ARRAYOWN + STR04 result. The identity-by-identity proof is `assertion-and-merge-proof.json`.

Preserved input hashes:

| Path                                                                  | Unchanged SHA-256                                                  |
| --------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `packages/safejs/src/interp/methods/regex-cursor.test.ts`             | `cc5dad2313bd152615e255b72b8064a72c77f142cd3d055f84b1ad0ee20e8f19` |
| `packages/safejs/src/interp/methods/regex-cursor.independent.test.ts` | `c8e459902a8550eb373eed6f69893f140986135ca336227d690bee13548b2d82` |
| `docs/plans/safejs-validate-str-04.md`                                | `11ddae5118af033434a4b5f66d19bf502b2f14dae1ec8269d1506ed809519b72` |

### Actual three-way merge and upstream preservation

Ran `git merge-file --diff3 -p` on three owned evidence copies, without modifying any input clone:

| Input          | Base / SHA-256                                                                                                                 |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Ancestor       | `a962264d3ec5f40c91f4e1a1bc15f3148fff3091`; string preimage `0dd53f36441b5b3edbccb5b25115b74d036e22c254313449d55871d7f4664d84` |
| Current        | `7fec2826bac2933483c2579ff47d2264f8e1f422`; string preimage `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b` |
| Incoming STR04 | `1501078eb9ddba91c703659a801b21202e9c050352b82666102c8786566c29a3`                                                             |
| Merged         | `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67`                                                             |

Merge exit **0**, **zero content conflicts**, **zero manual semantic resolutions**. The applied `string.ts` is byte-identical to the actual merge output, not a copy of the old author file. Only `replaceRegex`, `callSplit`, `callMatchLikeMethod`, `collectRegexMatches`, and their imports receive the original cursor changes.

AST-based checks establish that published STR03's `expandReplacement` and `callReplaceLikeMethod` are unchanged from current main; all expansion-call arguments remain unchanged, including `expandReplacement(replacement, match.text, match.captures, value, match.index)`. The token-helper text hash is `2ab9492d56ba958e4af4f76ed12d3635afbe147e744aec9df800a8d75edb9cf7`. Published replacement tests also pass dynamically.

All **44 other paths changed upstream between the old author base and current main** are verified byte-identical to current-base blobs, covering inherited ARRAY/OBJ/MC/TREE/HI/COLL source, tests, and documentation. See `upstream-preservation.json`. The only tracked implementation diff is `string.ts`; there is no fresh ARRAY accessor patch.

Harness correction retained honestly: the first apply-patch adapter supplied numbered unified-diff headers, which `apply_patch` rejected without modifying production. The command then redundantly reran the still-RED base (476 failures); this is retained as `merge-not-applied-rerun.log` and its JSON, not labeled GREEN. Correcting the header conversion applied the unchanged clean three-way result. No test expectation or merge semantics changed in this correction.

### Complete original output and cursor timeline

Native was established first; the unchanged original then ran against the unmodified current base and twice against merged current TypeScript, with empty guest modules, 5,000-step budget, native VM timeout 1,500 ms, and current child timeout 10,000 ms.

Current-base full return (`nodeVisits: 52`):

```json
{
  "all": ["a", "a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 2,
  "replaced": "XbX",
  "afterReplace": 2
}
```

Native and both merged full returns (`nodeVisits: 49` on each merged run):

```json
{
  "all": ["a"],
  "afterMatchAll": 2,
  "matched": ["a", "a"],
  "afterMatch": 0,
  "replaced": "XbX",
  "afterReplace": 0
}
```

Timeline: assign **2** → matchAll preserves **2** and yields one match → global match resets to **0** → assign **2** → global replacement resets to **0**. `original-full-expected-actual.json` contains complete values, source, exact command, and repeat-equality evidence. This original has full native parity, not merely cursor-field parity.

### Integration gates

| Gate                                                 | Result                                                                                                   |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| Focused unchanged suites                             | 1,439/1,439 pass                                                                                         |
| Published string/core regression selection           | **31 files, 2,773 tests pass**, 6.30 s total / 4.52 s tests                                              |
| Configured explicit types for both cursor test files | Exit 0; root config inherited, effective config captured                                                 |
| Package source types                                 | Exit 0                                                                                                   |
| Root configured types                                | Exit 0                                                                                                   |
| Full repository ESLint                               | Exit 0                                                                                                   |
| Full root build                                      | Exit 0; **67/67** Turbo tasks, 28.633 s Turbo phase; schema generation, root compile and bundle complete |
| Package lint after build                             | Exit 0; **17/17 rules**, 68 packages                                                                     |

Broader selection includes all method/regex/global tests, the core interpreter tests, ARRAYOWN metadata and call-order tests, metadata-validation, both HI002 Markdown-offset suites, and both contextual-from suites. Thus published STR03, ARRAY, OBJ aliases, MC, TREE, HI, and collection checks run without importing their old candidate clones. Exact invocation:

```sh
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals packages/safejs/src/interp/interpreter.test.ts packages/safejs/src/run.array-own-metadata.test.ts packages/safejs/src/run.call-order.test.ts packages/safejs/src/metadata-validation.test.ts packages/safejs/src/loader/markdown-offset-hi-002.test.ts packages/safejs/src/loader/markdown-offset-hi-002-validation.test.ts packages/safejs/src/parse/contextual-from.test.ts packages/safejs/src/parse/contextual-from-validation.test.ts --reporter=dot --reporter=json --outputFile=out/safejs-remediation/str-04-integration/published-core-broader-results.json
env -u TERM ./node_modules/.bin/tsc -p out/safejs-remediation/str-04-integration/tsconfig.tests.json
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM npm run lint:types
env -u TERM npm run lint:eslint
env -u TERM npm run build
env -u TERM npm run lint:packages
```

Prettier checks the five publishables; only this newly appended section is formatted, preserving the author-plan prefix and validator files. `git diff --check` checks the production diff. No new unit test is authored, so no filesystem fixture is introduced. No LLM/guest I/O, novel resource/security probe, excluded audit workload, full repository test job, or screenshot job runs. CLI presentation is unchanged.

### Exact integration freeze and qualifications

Candidate root: `out/safejs-remediation/str-04-integration/candidate-7fec2826-str04/`. It contains five exact publishables, current-base preimages (absence recorded for new paths), ancestor/current/incoming merge inputs, preserved incoming manifests, full fresh test/original outputs, and assertion-identity proof. All copied bytes are hash-verified and sealed read-only/immutable; the manifest digest is external in `manifest.sha256`.

Publishables only:

1. `packages/safejs/src/interp/methods/string.ts` — current preimage `f836cb3508b1c9602f2d558cb68fdae9615d43d1b8da9504a62585cbd1b0981b`; merged `95d643bfce0a5dbb56b0187a2e21ca5efca8ce2977f3de1331e5831f452dae67`.
2. `packages/safejs/src/interp/methods/regex-cursor.test.ts` — new to current base, unchanged incoming author bytes.
3. `packages/safejs/src/interp/methods/regex-cursor.independent.test.ts` — new to current base, unchanged incoming Gödel bytes.
4. `docs/plans/safejs-fix-str-04.md` — new to current base; incoming prefix unchanged plus this integration appendix. Final hash recorded externally to avoid a self-hash cycle.
5. `docs/plans/safejs-validate-str-04.md` — new to current base; unchanged historical validator report, not an integration approval.

The upstream master plan is not edited. The historical validator report's pending verdict remains historical; fresh Gödel validation must evaluate these exact merged bytes. No publication approval is inferred from this author's passing gates.

Unpublished regex metadata own-key ordering, STR02 no-match-null, and STR05 split-capture changes are **not included**. `regex.ts` remains at current-base SHA-256 `e48034b3bfb3a06687ee60aee124b417ee41aec6c0e120d250a99ba4d4738bc1`; ordering remains pending. The historical no-match/capture qualifications therefore still apply outside the fully passing original r05 and unchanged cursor suites. No unsupported regex flags/features are introduced.

Build-created terminal font copies are excluded from the five-path handoff, as are all local evidence/configuration. No branches, commits, pushes, stashes, resets, other-clone writes, CI/release certification, or overall-goal completion occurred. There is no late pull: candidate ancestry and preimages are pinned to the stated ARRAYOWN base.
