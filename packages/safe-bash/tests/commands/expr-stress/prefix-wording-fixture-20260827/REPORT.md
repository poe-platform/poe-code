# New inactive-prefix diagnostic fixture overlay

## Ownership and exact change

Delegated author leaf; no redelegation. The only canonical change is
`tests/commands/expr/inactive-prefix.test.ts:127`, committed separately as
`efb1a25aa3e2544cf71aba10f2aaa54b256091ff`. One shared stderr string literal
expands to exactly four active unsupported-locale assertions: length, index,
substr and match. Every other fixture byte is unchanged. In particular argv,
environment, options, status 2, empty stdout, empty jobs, encoding observations,
cancellation checks and all unrelated assertions remain unchanged.

These are NEW author tests introduced by
`4f01c1593486c1abff3b007f9a3b16923b88559f`, not old native-oracle inputs.
The diagnostic now matches the already implemented named-profile diagnostic
at `src/commands/expr/internal.ts:111`, introduced in source commit
`246aa440c988d6c09464480956c4eff69009f7e4` and present in immutable 4f:

```text
expr: character operations require C/POSIX, C.UTF-8/C.utf8, or qualified en_US.UTF-8 encoding
```

The expected string ends with one newline. The four cases all retain
`LC_ALL=unsupported-inactive-profile`; they are four operations in the same
unknown locale, not four newly allowed locale names. `exact-four-rows.json`
preserves each argv, options, environment, original expected tuple, new expected
tuple, observed tuple, stdout/stderr bytes and empty jobs. These four probes
duplicate the canonical cases and are not additional acceptance tests.

## Distinct cohorts; no historical greenwashing

| Cohort | Source qualification | Result |
| --- | --- | --- |
| Preserved independent original author suite | Immutable combined 4f, original tests | **221/225, four RED** |
| Preserved older isolated author suite | Immutable 21220b46 plus evaluator/new-test overlays only | 217/217; not combined 4f qualification |
| This author baseline | Immutable combined 4f, original inactive-prefix fixture | **64/68, four RED** |
| This NEW fixture overlay | Identical immutable 4f source, only fixture from efb1a25a | **68/68** |

The original independent 221/225 result remains RED. Its completed raw capture,
provenance and issue receipt are copied byte-for-byte to `historical/`, with
origin paths and hashes. The reviewer was not contacted, rescored or modified.
The older 217/217 capture, source binding, report and summary are separately
preserved from evidence commit `d2115bc6be84bf2102cd64ffd1cf23db61ff83b3`.
That cohort used accepted source
`21220b465537bf45ffcfb36740956a69f43bf75e` plus exactly the evaluator/test
overlays; it did not include the combined named-profile source. Neither old
cohort is relabeled as validation of this fixture overlay.

## Executed scoped validation

`run-02/` is the final author capture. Both original-fixture and overlay runs
contain exactly 68 tests, with identical test names and zero cancellations,
skips or TODOs. The only four baseline failures are the four active locale
assertions; all four continue to refuse with status 2 in the new cohort.
`assertion-delta.json` authenticates the whole-file one-literal replacement,
four expanded assertions, zero changed inputs and zero unrelated case changes.

Scoped TypeScript passes with strict NodeNext, `noUncheckedIndexedAccess`,
`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, and `skipLibCheck=false`.
The compiler entry is only the owned fixture and its actual transitive imports;
the raw `--listFiles` output records coverage. This is not all-source/test or
public-consumer qualification. The regex-worker prerequisite is compiled
separately from immutable 4f source into isolated `dist`, using the same strict
flags. No global build, new dependencies, live product overlay, existing built
artifact copy, repeat-worker patch or native recapture is used.

The capture authenticates all 252 extracted files against Git, including all
246 product source files. Before overlay, the extracted input tree remains
identical to the archive. Afterwards the only permitted input delta is the
owned fixture. Product files and the complete generated worker tree are
unchanged. Exact-tree checks detect appended entries outside the two declared
generated roots: the existing-toolchain `node_modules` symlink and isolated
worker `dist` (which itself receives a full before/after tree comparison).
External mutable tooling is identified by installed package versions/package
hashes and compiler hash, not claimed independently rebuilt or fully pinned.
Unrelated dirty live files neither enter nor veto the immutable source run.

`run-01/` is preserved in full: it produced the same runtime/type results, but
its cleanup metadata incorrectly called absence of native-oracle processes
`nativeProcessesStarted=false`; Git/tar host tooling did run. The executed
driver is preserved there as data. `run-02/` corrects only that cleanup field
to `nativeOracleProcessesStarted=false`, lists Git/tar/Node explicitly, and
records the capture-driver hash. No original capture is rewritten.

## Hashes

| Artifact | SHA-256 |
| --- | --- |
| Original complete 4f fixture (`original-4f01c159.test.ts.data`) | `50a1748f93ce4781b7a765227e07e4e7ad7e35c6f8ae46cf36ea93631d575c70` |
| New fixture overlay | `52e079b8bc89f1b8e4f2b256baab11f8388a5f54d23c174d64d8a4de9c194c3e` |
| Extracted immutable source archive | `5d0d9a5a76360f4d788c27529915440dea197257ca9c0b405936167701f20123` |
| Product source inventory | `f08b5fdb469741e44b1878b2fc561da2fb0c49b2de96c166ca632e504a8949e3` |

The source-inventory hash is SHA-256 of `JSON.stringify` of the recorded
ordered path/size/SHA-256 entries, not the formatted JSON file bytes. Immutable
4f `src` Git tree: `6bff81f1a33d830d3c537c0d84868350a5d231a7`.
`MANIFEST.json` inventories the final evidence files separately.

## Cleanup, remaining limits and handoff

Both author runs settled all synchronous bounded child processes and removed
their owned temporary directories, including worker build artifacts and the
toolchain symlink. No owned processes remain. Worker threads end with their
test process; this tiny fixture cohort adds no lifecycle instrumentation or
claim about opaque host work. Other workers' temporary files are untouched.

The old one-byte output RED, 19 encounter-order failures and separate
`tests/commands/expr/contracts.test.ts:40` en_US-refusal assertion remain
untouched, not rerun or waived. That contracts file is archived and verified
unchanged; its separate one failure is not included in the 68-test cohort.
There are no product/public/full-gate/full-GNU-parity or completion claims.

Author receipt is ready for a **different verifier**, to be assigned by the
coordinator after receipt. This leaf does not redelegate or claim independent
verification. For an opt-in isolated replay, use a fresh output name:

```sh
node tests/commands/expr-stress/prefix-wording-fixture-20260827/capture.mjs run-verifier-unique
```

The replay binds immutable 4f source and the exact committed fixture, never
live product bytes. Existing output directories are refused rather than
rewritten. Historical preservation is one-shot; it is not part of replay.
