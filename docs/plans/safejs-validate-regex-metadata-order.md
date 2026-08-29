# Independent regex metadata own-key ordering validation

## Decision and scope

**Scoped ready for publication; not full original-workflow/native parity.**

- Independent delegated validator, working directly for the root orchestrator on August 29, 2026.
- Only writable clone: `/Users/kjopek/Workspace/poe-code-safejs-regex-metadata-order`.
- Frozen base: `ecfd838abd37fb061d66dc8721bc3f86067139ad`.
- Author manifest: `out/safejs-remediation/regex-metadata-order/candidate-ecfd838a-regex-metadata-order/manifest.json`.
- Verified author manifest SHA-256: `e3fe30b28fb0fcefc28641092ed223b0deac9fe3680d6f524478f5690698d1bd`.
- Verified all three author working/frozen publishables, production base preimage, six unchanged references, and selected author RED/GREEN/broader/original evidence hashes.
- Read ancestor and clone-root AGENTS; no deeper package/docs AGENTS apply. No production or author-test/report edits, commits, pushes, branches, other-clone writes, README changes, or CLI presentation changes.

The production diff is exactly one `Object.assign` property-order change in `toMatchArray`: `groups, index, input` becomes `index, input, groups`. Values and callers are unchanged. There are no accessor, cursor, parser, engine, supported-flag, or descriptor-implementation changes. This base includes STR03 but not ARRAYOWN.

## Read guard and unchanged original

Before any original payload read, bootstrapped only `inventory-verification.json` metadata from the original audit. Installed the exact **38 exclusions**, denied the entire `security/` directory, and used an explicit one-file allowlist. Exclusion-list SHA-256, using `JSON.stringify` in metadata order: `31d6082a11baf18b246ccaa0843e8aa488f1a289348a7a5c24b6e19cbd3b0c13`.

The only original payload read/copied/executed was `out/safejs-audit-2026-08-27/strings/reductions/r01-match-metadata.safejs`, SHA-256 `0d5bef1aede138e38a3f8d8367a61f601dc451b0167c2d15590d230009b8f2ce`. The reader checked exact allowlist membership, exclusions, directory boundary, and unchanged realpath before reading. The copied bytes and the qualification test's source literal are identical, including the final newline; verified with the TypeScript AST. No original writes, recursive audit scans, excluded reads/hashes/execution, security research, guest I/O, or LLM calls occurred.

The original source was executed natively first in a VM with a 1500 ms timeout, then unchanged through `packages/safejs/src/run.ts`. No source adaptation was used to manufacture parity. The complete native assertion remains a real failing assertion in ignored qualification evidence, not a skip or expected-failure declaration.

| Original comparison                   | Frozen base     | Candidate       |
| ------------------------------------- | --------------- | --------------- |
| Differing ordered-key leaves          | 9               | 0               |
| Differing named `index`/`input` reads | 6               | 6               |
| Complete native assertion             | FAIL            | FAIL            |
| Separate qualification tests          | 2 fail / 1 pass | 1 fail / 2 pass |

Native returns three records, each with `text: "ab"`, `capture: "b"`, `index: "2"`, `input: "🧪ab"`, and `keys: ["0", "1", "index", "input", "groups"]`. Candidate returns the same complete records except `index` and `input` are both the string `"undefined"` on each record. Raw match arrays have correct metadata values; guest named array reads still need ARRAYOWN. The complete expected/before/after outputs and every differing leaf are in `original-full-output-comparison.json`.

Repeat checks confirm identical full return values and deterministic stats. Two earlier versions of the validator-only repeat assertion mistakenly compared the entire execution wrapper: first its randomized snapshot seeds differed, then seeded wrappers still contained distinct runtime identities. Those test versions and failing logs are retained. Only this auxiliary repeat assertion was corrected to compare the complete return value and stats; the native full-output assertion and original guest source were never weakened or changed.

## Independent tests and genuine RED

Added `packages/safejs/src/interp/methods/regex-metadata-order.independent.test.ts`, importing actual package source, not built declarations or a rewritten implementation.

- 128 native-anchored cases: four bounded patterns across 32 operation/flag combinations. Exec covers all 16 subsets of `g,i,m,s`; non-global match covers eight `i,m,s` subsets; matchAll covers eight global subsets.
- Patterns cover unmatched optional captures, empty-string captures, twelve captures with numeric keys beyond `9`, UTF-16 offsets, zero-width matches, multiline anchors, case folding, and dotAll.
- Every case checks exact ordered enumerable keys, full host own-key order including `length`, complete ordered entries, array length, dense numeric capture presence and values, and own `groups: undefined`. Guest reflection separately checks complete keys/entries/values/own presence/elements.
- 32 no-match controls cover exec, non-global match, and matchAll; eight successful global-match controls verify collections have no per-match metadata.
- One explicit typed control distinguishes an own undefined optional capture and own undefined groups from a hole and an empty-string capture. Strict comparisons and direct ownership checks preserve undefined; JSON is not used as the parity oracle.
- No unsupported flags, named-capture grammar, general descriptor-parity claim, cursor repair, or ARRAY accessor repair is introduced. Global-match no-match STR02 behavior is not relabeled as fixed.

Baseline execution loads only the exact frozen `regex.ts` Git blob through a Vite pre-load hook. Working production files never change. The same final tests and assertions run against the candidate without the hook.

| Suite            | Frozen base RED        | Candidate GREEN         |
| ---------------- | ---------------------- | ----------------------- |
| Independent      | **129 fail / 40 pass** | **169 pass**            |
| Author replay    | **21 fail / 2 pass**   | **23 pass**             |
| Combined focused | **150 fail / 42 pass** | **192 pass**            |
| Relevant broader | Not claimed            | **491 pass / 13 files** |

The broader suite is the author's 322 cases plus 169 independent cases. It includes the existing STR03 replacement suites (98 author cases and 63 validation cases), string/array/regex methods, regex parser/engine, and relevant object/array/misc globals. No tests are skipped in these scoped runs. No full SafeJS or repository-wide test count is claimed.

## Commands and gates

Evidence root: `out/safejs-remediation/regex-metadata-order-validation/`. All Vitest runs use `env -u TERM POE_SNAPSHOT_MODE=playback POE_SNAPSHOT_MISS=error`, verbose or dot logs, and JSON result reports. Tests are bounded and pure; no test creates filesystem fixtures.

1. Focused: `./node_modules/.bin/vitest run packages/safejs/src/interp/methods/regex-metadata-order.test.ts packages/safejs/src/interp/methods/regex-metadata-order.independent.test.ts`. RED adds `--config out/safejs-remediation/regex-metadata-order-validation/baseline.config.ts`.
2. Original qualification: `./node_modules/.bin/vitest run out/safejs-remediation/regex-metadata-order-validation/original.test.ts --config out/safejs-remediation/regex-metadata-order-validation/original.config.ts`. RED substitutes `original-baseline.config.ts`. Both intentionally exit 1 for retained real failures.
3. Broader: `./node_modules/.bin/vitest run packages/safejs/src/interp/methods packages/safejs/src/interp/regex packages/safejs/src/interp/globals/object-array.test.ts packages/safejs/src/interp/globals/misc.test.ts`.
4. Workspace declaration build before types: `env -u TERM ./node_modules/.bin/turbo run build --output-logs=errors-only` — **67/67 successful tasks**. This is not a claim that the root bundle pipeline was rerun.
5. Explicit test types: `./node_modules/.bin/tsc -p out/safejs-remediation/regex-metadata-order-validation/tsconfig.tests.json --noEmit` — exit 0. Effective configuration includes author, independent, and original qualification tests; no test relies on the package's test exclusion for a false pass.
6. Package types: `./node_modules/.bin/tsc -p packages/safejs/tsconfig.json --noEmit` — exit 0. Root configured types: `env -u TERM npm run lint:types` — exit 0.
7. Full configured repository ESLint: `env -u TERM npm run lint:eslint` — exit 0. Package lint: `env -u TERM npm run lint:packages` — **17/17 rules, 68 packages**, exit 0.
8. Prettier checks cover all five publishables; `git diff --check` covers the tracked patch. Initial independent-test formatting warning is retained; formatting-only corrections use `apply_patch`. Final checks pass.

## Publication and remaining dependencies

Publish exactly five paths: the unchanged author `regex.ts`, author ordering test and fix plan, plus the independent ordering test and this validation plan. Freeze under `out/safejs-remediation/regex-metadata-order-validation/candidate-ecfd838a-independent/`, retaining exact publishable bytes, base preimages, validation-entry preimages, evidence, and SHA-256 manifest. Only `regex.ts` exists at the frozen base; the four test/plan additions have explicit absent preimages. Author files must match their entry hashes. Frozen copies are read-only and immutable; working files remain unsealed. `.git/info/exclude`, all `out/` evidence, and pre-existing terminal-pilot assets are not publishables.

ARRAYOWN integration is required before claiming complete original metadata parity. STR01/STR02/STR04/STR05 and other previously qualified workflows are not closed by this validation; the other nine original workflows were not reread or rerun. No prior clone/evidence was changed. Fresh independent validation of the merged production tree is mandatory after ARRAYOWN or other string fixes are integrated. Publisher must also run fresh final integration/full gates. Scoped readiness here certifies only this exact metadata creation-order candidate.
