# Decision brief: proposed canonical adapter-tool profiles

**Proposal only; root approval required. No canonical migration is performed.**
This document is the sole change in this continuation. No tests, builds,
downloads, source/API changes or root-file changes are performed. The acceptance
at `2967814` qualifies frozen `68059389bf95e03caeae6479837187add3d07814`, not the
advanced root release. Existing seals and `REPORT.md` remain unchanged.

## Proposed additions and exact existing-file impact

All paths below are relative to `tests/integration/adapter-tools/`:

```text
profiles/
  profile-inputs.json
  generate-shared.mjs
  run-profiles.mjs
  shared/
    workloads.ts
    fixtures.ts
  stock-webdav.fixture.ts
  configured-atomic-webdav.fixture.ts
  stock-webdav-capability.test.ts
  configured-atomic-matrix.test.ts
  workload-byte-equivalence.test.ts
  evidence/<new-candidate-cohort>/
```

**Existing files changed after approval: none in this additive proposal.**
Root would approve creation of these paths and assign an implementation owner;
this is not authorization to rewrite existing files. In particular, leave these
existing inputs byte-identical, at their current paths:

- `tests/integration/adapter-tools/matrix.test.ts`, including its positive
  empty-rmdir assertion and all nine readonly-refusal rows;
- `tests/integration/adapter-tools/fixtures.ts` and
  `tests/integration/adapter-tools/preflight-review/preflight.ts`;
- `tests/fs/webdav/mock.ts` and the original S3/mock/product sources;
- `tests/integration/adapter-tools/atomic-webdav-profile/**` and existing
  `tests/integration/adapter-tools/atomic-webdav-profile-independent/**` evidence,
  including original raw failures, archives, manifests and seals.

Do not change `package.json`, either root tsconfig, exports, contracts or
production. The existing `npm test` discovery still includes the original stock
matrix and its known failure. The proposed profile gate is **not** a green
replacement for that full suite. Any later root test-entrypoint/archive/discovery
change needs a separate, explicit approval and coverage-preservation decision;
do not exclude or skip the old positive to make the suite green.

## Shared workload and fixture interfaces

These are proposed **test-local interfaces**, not existing product exports:

- `shared/workloads.ts`: `registerAdapterToolWorkloads(bindings:
  MatrixFixtureBindings): void`. Registers every original row exactly once per
  profile. `MatrixFixtureBindings` carries the original imported names:
  `allFamiliesDispatched`, `change`, `fsError`, `original`, `payload`, `revised`,
  `snapshotTree`, `success`, `withFixture`, `writableAdapters`.
- `shared/fixtures.ts`: `createFixtureProfile(options: FixtureProfileOptions):
  MatrixFixtureBindings`. The only profile option is an optional
  `webdavAtomicBinding(dav: MockDav, namespaceUrl: string):
  WebDavAtomicEmptyDirectoryBinding`. Its bound `withFixture(name, run, plugin?)`
  retains the existing `AdapterName`, `Fixture` callback and optional plugin
  signature; omitted plugin still means actual `agentCommands()`.
- `stock-webdav.fixture.ts`: exports `stockWebDavProfile =
  createFixtureProfile({})`; WebDAV has **no** atomic binding.
- `configured-atomic-webdav.fixture.ts`: imports the existing sealed
  `atomicMockBinding` from `../atomic-webdav-profile/atomic-mock.js` and exports
  `configuredAtomicWebDavProfile = createFixtureProfile({ webdavAtomicBinding:
  atomicMockBinding })`. Do not fork or silently edit that helper.
- `configured-atomic-matrix.test.ts`: calls
  `registerAdapterToolWorkloads(configuredAtomicWebDavProfile)` once, without
  filtering backends/rows or adding another registration through imports.
- `stock-webdav-capability.test.ts`: uses `stockWebDavProfile.withFixture` for
  **two separately named refusal rows**: `stock-webdav: empty rmdir is ENOTSUP`
  and `stock-webdav: nonempty rmdir is ENOTEMPTY`. Each checks direct typed
  `FsError`, actual aggregate `rmdir`/`rm -d` behavior, no HTTP DELETE and exact
  namespace/child-byte preservation. This is not the old failing positive row.

`generate-shared.mjs` deterministically derives the two shared modules from the
sealed original matrix/fixture inputs. They are tracked, typechecked TypeScript,
not independent hand-maintained workload copies. Preserve all six writable
adapters, original seeds, S3 settings, real-root isolation, HTTP bridge, deadlines,
cleanup, dispatch checks, original preflight and readonly behavior. Parameterize
only WebDAV fixture construction to accept the binding factory. Stock leaves it
unset; configured adds `atomicEmptyDirectory: atomicMockBinding(dav,
baseUrl.href)` to that same backing adapter. No other backend setup changes.

## Equivalence and candidate gate

`profile-inputs.json` pins the original revision, exact input SHA-256 values,
extraction boundaries and an explicit transformation inventory. Use the existing
matrix seal `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d`
and workload-body seal
`2d6700674dbaadd10fba3765def70a647709ed7578c10bbc2f783fe4cbac64bf`;
retain fixture/mock/preflight/helper seals from the accepted manifests.

`workload-byte-equivalence.test.ts` must prove that the complete body beginning
at `const digest =` is an exact byte slice inside the registration function.
Keep original body indentation, literals, commands, assertions and row names;
do not normalize whitespace, line endings, diagnostics, expected values or AST
printing. Function/import/binding scaffolding lies outside that slice. Require
unique replacement matches and reverse every declared fixture transformation to
recover the original fixture bytes. Reject undeclared differences.

Allowed generated changes are explicit: relative imports relocated for the new
paths/public package; registration-function and binding scaffolding; fixture
factory/binding-parameter plumbing; and the configured helper import/WebDAV
option. Virtual-path/URL normalization remains original production/helper
behavior, not a harness rewrite of test input. Workload equivalence is **not**
unchanged-all-inputs proof: configured fixture inputs deliberately differ.

`run-profiles.mjs` must freeze the actual candidate source and test/helper closure,
check generated-file reproducibility, build/typecheck in owned isolation, pack,
and run in a differently named strict NodeNext public consumer. Run unchanged
original stock inputs, packed stock, configured full matrix and stock refusals
as distinct cohorts; record actual module resolutions/hashes and cleanup.
Preserve the original MockDav bookkeeping import relocation explicitly, including
its frozen-built resource-id/errors closure; do not introduce private identity
access. Preserve all raw failures. No runtime dependency install is required.
Changes in a new candidate require fresh evidence; old cohort hashes certify
neither new source nor new generated helpers.

| Cohort | Required reporting policy |
| --- | --- |
| Frozen original and packed stock | **69/70 workflow + 9/9 readonly = 78/79**; original WebDAV ENOTSUP failure remains historical evidence, never waived |
| Frozen configured matrix | **70/70 workflow + 9/9 readonly = 79/79** |
| Future configured candidate | Target the same 70 + 9 rows; require actual fresh results, zero skips/TODO/cancellations and byte-equivalence gate |
| Future stock capability controls | **2 separate refusal rows**, target 2/2 only after execution; never added to the 79-row matrix |
| Existing controls/mutations | Author 22/22, independent 27/27 and 10 caught mutants remain separate historical cohorts |
| Real WsgiDAV | Separate service/profile/source/auth evidence; no addition to mock denominators |

The 70 workflow rows include deliberate error/cancellation/limit checks; 79/79
does not mean 79 positive mutation demonstrations. Report current stock results
as observed; any drift from frozen 78/79 needs adjudication, not altered expected
bytes. Equivalence checks are another gate, not extra matrix successes. The
shared modules retain every legitimate TypeScript helper/assertion; archives
remain explicitly classified evidence data, not blanket test exclusions.

## Callback scope and release separation

The configured mock delta supplies the production `atomicEmptyDirectory`
callback accepted at `d1174e2`. The helper checks and removes only an empty
directory synchronously on the **actual public `MockDav.files` backing**, using
the original Map methods and locks. No yield between check/delete, recursive
DELETE, child loss, fabricated identity/disjointness or `atomicRename` capability
is permitted. Namespace/path/receipt guards remain required; a bad receipt cannot
undo a completed host effect. This single-process helper is not a distributed
atomicity, lease, transaction or ABA guarantee. WebDAV-upper overlay ENOTSUP
remains a refusal; lower-overlay whiteouts are not host atomic removals.

The production callback requires a truthful, explicitly host-bound implementation
for the backing service; stock WebDAV does not acquire this capability from the
test fixture. Prior independent real WsgiDAV evidence at `4453490` / `b22d00c`
remains the separate service basis. This proposal is not new interoperability
proof and changes no production callback API/source.

The prioritized timestamp helper `456a073` and author seal `9c57f0f` are a
separate release line. Per the root handoff, its original/author/postcondition
results are 13/13, 19/19 and 5/5, and another verifier has 23 independent checks
plus three caught mutants while sealing. This continuation does not rerun or
independently certify those results, merge their denominators, or infer that the
advanced root release is qualified by the frozen 68059389 matrix.

**Root decision requested:** approve or reject this additive path/interface/gate
layout and assign its implementation. Until then, only this proposal exists;
all canonical inputs and prior seals remain untouched.
