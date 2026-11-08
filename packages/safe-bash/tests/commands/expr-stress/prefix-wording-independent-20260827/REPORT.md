# Independent prefix-wording fixture verification

Independent verifier leaf, not the fixture author; no redelegation. This review
owns only this new evidence directory. The author's report was read for context;
its driver was not executed and its results were not substituted for this run.

## Exact qualification

- Immutable product/source: `4f01c1593486c1abff3b007f9a3b16923b88559f`.
- Fixture-only overlay: `efb1a25aa3e2544cf71aba10f2aaa54b256091ff`.
- Fixture: `tests/commands/expr/inactive-prefix.test.ts:127`.
- efb parent: `eba049535d154f4e028f57ffd8efd7622b2239ca`.

Git inspection confirms efb changes exactly one file, one deletion and one
insertion. Its parent fixture is byte-identical to the 4f fixture. Replacing
exactly one old stderr literal produces the entire efb fixture, byte-for-byte.
AST inspection confirms that literal belongs to the active unsupported-locale
loop over exactly length/index/substr/match. `run-01/delta.json` records the
four expanded argv/options/environment/expected-tuple rows, not extra tests.

All other fixture bytes remain identical: `LC_ALL=unsupported-inactive-profile`,
argv, options, status 2, empty stdout, empty jobs, encoding observations,
cancellation checks, and unrelated assertions. This is four operations in one
unknown locale, not additional locale support. The expanded diagnostic already
exists in immutable 4f `src/commands/expr/internal.ts:111`.

The whole efb tree is **not** claimed identical to 4f: intervening commits changed
unrelated product files. Only the efb fixture blob enters our 4f-source cohort.
Neither live HEAD nor the whole efb source tree is qualified here.

## Independently executed results

| Cohort | Pass/total | Fail | Skip/cancel/TODO |
| --- | --- | --- | --- |
| Original immutable 4f fixture | 64/68 | 4 | 0/0/0 |
| NEW efb fixture on identical 4f source | 68/68 | 0 | 0/0/0 |
| Temporary wrong-wording expectation | 64/68 | 4 | 0/0/0 |
| Temporary wrong-status expectation (0 instead of 2) | 64/68 | 4 | 0/0/0 |

All four runs have identical 68 test names. Every negative run fails precisely
the four active unsupported-locale rows with `ERR_ASSERTION`; raw TAP retains
actual status 2, empty stdout, and the implemented diagnostic. These controls
demonstrate that the assertions are live, not removed or bypassed. Negative
fixtures existed only inside this capture's owned temporary candidate; the
overlay was restored and checked before cleanup. Original data was not edited.

Original and overlay strict scoped typechecks both exit 0: NodeNext/ES2023,
strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes,
verbatimModuleSyntax, and skipLibCheck=false. Each `--listFiles` log contains
32 product TS files, the fixture and helper, plus toolchain declarations;
this is not all-source/test or public-consumer type qualification. The regex
worker prerequisite alone was built strictly from 4f into isolated `dist`.

## Integrity and reproducibility

`run-01/inputs.json` inventories 252 extracted files, including 246 product
files. Every extracted file was authenticated against its immutable Git blob.
Full before/after tree comparisons include files, directories and symlinks,
so appended entries are checked, not merely the originally tracked paths.
There are no ignored candidate roots: generated `dist` is fully compared;
the external `node_modules` symlink target is compared but not traversed.
All product bytes and the preserved `contracts.test.ts` remain unchanged.

| Binding | Hash |
| --- | --- |
| 4f src Git tree | `6bff81f1a33d830d3c537c0d84868350a5d231a7` |
| Product inventory before **and** after | `0207037ff5f726b7201c0da2ddb8a077e4fb32943daa393ad2492c9894a78d25` |
| Original fixture SHA-256 | `50a1748f93ce4781b7a765227e07e4e7ad7e35c6f8ae46cf36ea93631d575c70` |
| Overlay fixture SHA-256 | `52e079b8bc89f1b8e4f2b256baab11f8388a5f54d23c174d64d8a4de9c194c3e` |
| Extracted archive SHA-256 | `5d0d9a5a76360f4d788c27529915440dea197257ca9c0b405936167701f20123` |

The product inventory hash is SHA-256 of JSON.stringify(snapshot(src)): ordered
relative paths, directory records and file byte lengths/SHA-256. Its format
differs from the author's inventory, so those inventory hashes need not match.
`integrity.json` records every phase; `generated.json` records the worker tree.
`MANIFEST.json` seals this evidence separately, excluding itself.

Run on Darwin arm64, Node 22.22.2; installed TS 5.9.3/tsx 4.23.12 and selected
toolchain hashes are recorded, not claimed fully pinned or independently built.
No dependency installation, native oracle recapture, global build, live source
overlay, root edit, or canonical writer was used. Capture was August 27, 2026,
19:53:33–19:53:39 UTC; this is bounded work, not a duration/completion claim.

Opt-in replay refuses an existing output directory:

```sh
node tests/commands/expr-stress/prefix-wording-independent-20260827/capture.mjs run-unique-name
```

## Historical RED and limits

The original independent **221/225** stays immutable and historical, not
rescored. The older isolated **217/217** has different source composition and
is not merged. The reported one stale `contracts.test.ts:40` en_US assertion,
one byte-cap RED and 19 encounter-ordering failures remain untouched, not
rerun, waived, or claimed fixed. Those counts are retained scope boundaries,
not fresh measurements by this tiny review. Main reviewer 52016's original
4f review remains frozen; no review request or artifact was changed.

All synchronous owned children settled and this run's temporary directory was
removed, including negative fixture copies and worker build. Worker threads
belonged to exited Node processes; no separate lifecycle instrumentation or
opaque-host cleanup guarantee is claimed. Unknown artifacts were untouched.
This result qualifies only the specified fixture overlay, not public expr,
GNU semantics, a whole gate, or full-product behavior.

Precommit syntax and non-TAP whitespace checks pass. The full evidence
`git diff --cached --check` reports trailing whitespace in the four raw TAP
logs (including the unchanged empty abort-reason test name and assertion
formatting). Those captured bytes are deliberately preserved, not normalized;
this is not a runtime/typecheck failure or an assertion relaxation.
