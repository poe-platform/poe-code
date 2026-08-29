# STR-04 independent validation

## Role, scope, and isolation

Independent delegated validator, not the fix author. Workspace:
`/Users/kjopek/Workspace/poe-code-safejs-regex-cursor`; frozen author base:
`a962264d3ec5f40c91f4e1a1bc15f3148fff3091`. Date: August 29, 2026.
Applicable instructions: workspace-parent and clone-root `AGENTS.md`; no nested
instructions found under `packages/safejs` or `docs`.

No production edits, commits, pushes, other-clone writes, original-audit writes,
real LLM calls, guest filesystem activity, or security validation. Existing
unrelated files are untouched. CLI visuals are unchanged; screenshots are not
applicable to these interpreter-only checks.

## Audit guard

Before reading any original payload, parsed only bootstrap metadata
`/Users/kjopek/Workspace/poe-code/out/safejs-audit-2026-08-27/inventory-verification.json`.
Installed its exact 38 `archiveReadPolicy.excludedPaths` plus the entire audit
`security/` directory as exclusions. Exclusion-list SHA-256 in metadata order:
`31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.

The only explicitly allowlisted original functional file is
`strings/reductions/r05-global-lastindex.safejs`. Its canonical path was checked
against the exclusions and symlinks before reading/hashing. No recursive audit
scans, excluded reads/hashes/execution, or other original payload reads occurred.
The author's metadata-only preguard reads are not an excluded-payload incident.

The independent test embeds the unchanged complete workflow and asserts SHA-256
`ff1d8e2c92e66ce74f34bb84377ae15ea784536190bed83e17492e4e9997bc8d`.
Native Node executes it first. The complete expected return is:

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

## Independent test design and TDD

- Execute the full original unchanged, with exact full-result comparison.
- Compare all 16 combinations of supported `g`, `i`, `m`, `s` flags, three
  operations, four bounded pattern/input cases, and five finite cursors against
  native Node. Patterns exercise captures, case folding, multiline anchors,
  dot-all, zero-width advancement, and empty input. Non-global `matchAll` must
  throw without changing the cursor. No-match `match` shape is not normalized.
- Independently compare failed-scan cursor transitions followed by `exec`,
  without claiming the separate STR-02 return-value issue is repaired.
- Check copied scans across nested replacement callbacks and retained cursor
  mutations, with native and explicit expectations.
- Keep unsupported `y` and `gy` rejected; do not add sticky support.
- RED uses a Vite test-only loader to substitute the exact base `string.ts` Git
  blob in memory. Candidate production files remain untouched. GREEN uses
  current source. Tests do not create files or invoke external agents.
- Full data comparisons use `structuredClone` to cross the sandbox's intentional
  null-prototype object boundary, then `toStrictEqual`. Undefined fields, array
  entries, match indexes, captures, and cursor values remain asserted; there is
  no JSON normalization or omission of failing metadata. Explicit cursor checks
  precede the full-result checks.

## Execution record

Node `v22.22.2`, npm `10.9.7`. All commands ran in the assigned clone, against
current TypeScript unless explicitly using the in-memory base loader. Evidence
directory: `out/safejs-remediation/str-04-validation/`, locally ignored through
`.git/info/exclude`; neither the root ignore policy nor author artifacts changed.

| Check                                       | Result                                                                    | Evidence                                  |
| ------------------------------------------- | ------------------------------------------------------------------------- | ----------------------------------------- |
| Independent tests, base loader              | Exit 1; **449 failed / 578 passed**, 1,027 total                          | `red.log`, `red-results.json`             |
| Same independent tests, candidate           | Exit 1; **118 failed / 909 passed**, 1,027 total                          | `candidate.log`, `candidate-results.json` |
| Relevant broader suite                      | Exit 1; **118 failed / 1,444 passed**, 1,562 total; 9 files pass, 1 fails | `broader.log`, `broader-results.json`     |
| Author tests, independent base replay       | Exit 1; **103 failed / 309 passed**, 412 total                            | `author-red-replay.log`                   |
| Author tests on candidate                   | **412 passed**, included in broader run                                   | `broader-results.json`                    |
| Author's original broader scope             | **535 passed** across its unchanged 9 files, included in broader run      | `comparison.json`                         |
| Workspace declaration/build tasks           | Exit 0; **67/67 successful**                                              | `build-workspaces.log`                    |
| Root types, after workspace builds          | Exit 0                                                                    | `root-types.log`                          |
| SafeJS package types                        | Exit 0                                                                    | `package-types.log`                       |
| Independent test types                      | Exit 0                                                                    | `test-types.log`                          |
| Targeted and full repository ESLint         | Exit 0                                                                    | `eslint.log`, `eslint-full.log`           |
| Package lint, after build                   | Exit 0; **17 rules**                                                      | `package-lint.log`                        |
| Final issue-path formatting and diff checks | Exit 0                                                                    | `format.log`, `diff-check.log`            |

Final focused execution took 2.11 seconds total / 1.28 seconds in tests; broader
execution took 2.63 seconds total / 1.60 seconds in tests. There were no timeouts.
The independent suite contains 960 operation/flag/pattern/cursor combinations,
48 failed-scan continuations, 16 nested callback cases, two unsupported-flag
checks, and the exact original. All explicit cursor assertions and the original
full workflow pass on the candidate.

The 118 candidate failures also fail on the base. Comparing test identities
shows **331 repaired cases and zero newly failing cases** in this suite. This
does not make the remaining failures acceptable: they stay ordinary failing
assertions, not skips, expected failures, or weakened expectations.

Reproduction commands:

```sh
./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-cursor.independent.test.ts --config out/safejs-remediation/str-04-validation/red.vitest.config.ts --reporter=dot
./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-cursor.independent.test.ts --reporter=dot
env -u TERM ./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals/misc.test.ts --reporter=dot
env -u TERM ./node_modules/.bin/turbo run build --output-logs=errors-only
env -u TERM npm run lint:types
env -u TERM ./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit
env -u TERM ./node_modules/.bin/tsc -p out/safejs-remediation/str-04-validation/test-types.tsconfig.json --noEmit
env -u TERM npm run lint:eslint
env -u TERM npm run lint:packages
```

Harness-development failures are retained separately, not represented as product
regressions: `red-initial.log` and `green-initial.log` contain the initial
null-prototype strict-comparison mismatch and incorrect assumption that rejected
sticky construction resolves with `ok: false`. Those tests now compare cloned
data and assert the actual promise rejection. `red-misplaced-assertion.log` and
`broader-misplaced-assertion.log` retain an intermediate cursor-assertion placement
error, subsequently corrected to use each workflow's actual returned fields.
`test-types-initial.log` retains the missing discriminated-union narrowing,
corrected with Vitest's `assert(actual.ok)`. No production expectations were
relaxed. The earlier `green.log` is also a failing 118/909 run, not a green gate;
`candidate.log` is the final current-source result.

## Exact remaining failure and repair request

**Not ready for publication or a publishable candidate freeze.** STR-04's cursor
repair and full original workflow validate, but the independent suite exposes
unreadable match-array `index` properties: 102 matchAll matrix cases and 16 nested
callback cases fail their complete output comparisons.

Minimal bounded reproduction, independently authored rather than read from the
audit:

```js
const regex = /a/g;
regex.lastIndex = 2;
const matches = [..."aba".matchAll(regex)];
return {
  indexes: matches.map((match) => match.index),
  texts: matches.map((match) => match[0]),
  lastIndex: regex.lastIndex
};
```

Native: `{ indexes: [2], texts: ["a"], lastIndex: 2 }`.
SafeJS: `{ indexes: [undefined], texts: ["a"], lastIndex: 2 }`.
The undefined value is preserved in `minimal-index.log`, not serialized to null.

`packages/safejs/src/interp/methods/regex.ts` already attaches `index` in
`toMatchArray`. The unchanged `getArrayMember` in
`packages/safejs/src/interp/methods/array.ts` handles numeric indexes, length, and
intercepted methods, then returns undefined for other names. This is a functional
array-member/regex-metadata access defect, distinct from cursor state and from
the separately unresolved regex own-key ordering issue.

**Repair ask to orchestrator:** assign a separate fix author to make own regex
match-array `index` observable through sandbox member access without disrupting
array index/length/method behavior. Keep these 118 assertions intact; do not
remove index checks, erase undefined, normalize outputs, skip cases, or convert
them to expected failures. Then obtain fresh independent validation with this
unchanged suite and the relevant broader tests. No validator production edit is
authorized or made here.

## Limits and publication

STR-02 no-match null, STR-03 substitution tokens, STR-05 split undefined, and
regex own-key order remain separate unresolved issues. No overall audit,
security, full-suite, current-upstream, or release-success claim is made.
Non-finite/huge cursors, exotic coercions, unsupported flags, and performance
guarantees are outside this bounded validation.

STR-03 overlaps `string.ts`. Publisher must three-way merge against the recorded
preimage, not overwrite another approved change; fresh independent validation of
the merged cursor and substitution behavior is required before publication.

All 17 author-manifest-listed files and logs were hash-checked and remain
unchanged. The author production SHA-256 remains
`1501078eb9ddba91c703659a801b21202e9c050352b82666102c8786566c29a3`.
The only validator source-tree additions are
`packages/safejs/src/interp/methods/regex-cursor.independent.test.ts` and this plan.
The ignored evidence manifest records their hashes, base preimages for all five
potential issue paths, the author-manifest hash, exclusions, and test/check
results. No `candidate/` directory is frozen while validation is red. Unrelated
terminal font assets and all original author evidence remain untouched.
