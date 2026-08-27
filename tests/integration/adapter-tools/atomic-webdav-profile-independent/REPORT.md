# Independent decision: frozen configured test-only profile

## Bugs and retained failure first

No new production or author-fixture defect was found in this bounded review.
The original stock failure is reproduced, not waived: row 38,
`webdav: create, copy, append, inspect and remove files`, expects exit 0 but gets
exit 1 with `rmdir: ENOTSUP: rmdir has no safe portable WebDAV equivalent, rmdir
'/work/scratch/nested'`. Both original and packed stock retain it verbatim.

The first independent attempt stopped on a verifier mistake: an over-narrow
module-closure allowlist omitted the existing resource-id module's `FsError`
dependency. `ATTEMPTS.md` classifies the correction. No product/helper/test
expectation was weakened. Its original inputs and raw failure remain archived.

**Decision:** independently accept the frozen, explicitly configured **mock
test-only** profile at the checkpoint below. This is not approval to migrate
canonical inputs, certify the current dirty/advanced source, claim stock WebDAV
support, claim a new real-service result, or claim superiority/completion.

## Measured cohorts and exact denominators

Passing evidence directory: `evidence/independent-second/`.

| Cohort | Pass / tests | Failure / cancellation / skip / TODO |
| --- | --- | --- |
| Original stock, unchanged frozen TypeScript | 78 / 79 | 1 / 0 / 0 / 0 |
| Packed stock, public consumer | 78 / 79 | 1 / 0 / 0 / 0 |
| Packed configured, complete original row bodies | 79 / 79 | 0 / 0 / 0 / 0 |
| Author's separate controls, unchanged | 22 / 22 | 0 / 0 / 0 / 0 |
| Independent hidden controls | 27 / 27 | 0 / 0 / 0 / 0 |
| Independent hidden controls after restoration | 27 / 27 | 0 / 0 / 0 / 0 |

The 79-row matrix consists of 66 rows across six writable backends, four further
workflow rows (cross-mount, overlay-lower, readonly inspection, structured text),
and **nine explicit readonly-mutation refusal rows**. Thus the workflow/behavior
portion is stock **69/70**, configured **70/70**, with **9/9** explicit readonly
refusals in each. Some writable workflow rows themselves deliberately test
errors, cancellation and output limits: 79/79 must not be described as 79
successful mutation/positive-capability demonstrations. The author's proposed
wording “positive 79-row denominator” needs this qualification before adoption.

The 22 author controls are separately reported: four positive-removal/view rows
(direct helper, configured mount, two lower-overlay whiteouts) and 18 guard/
refusal-dominant rows. Lower-overlay whiteouts are not host atomic removals.
The independent 27 comprise six positive exact-removal rows (one direct and five
public encoded-path cases), one positive mount row, and 20 guard/refusal-dominant
rows. Some guard rows include setup/success subchecks; these classifications are
row labels, not new totals of individual assertions. Neither separate suite nor
270 mutant test executions is added to the original 79 denominator.

Build, strict original types, both strict packed-consumer typecheck/emission
runs, offline npm pack, tar extraction and public-boundary probe all exit 0.
Node is v22.22.2, TypeScript 5.9.3, Darwin arm64. Existing development tools are
reused; there are no dependency installations or provider downloads. Captured
execution runs on August 27, 2026 end at 09:14:53.297 UTC. Durations are not
benchmarks, a 72-hour work claim or evidence about concurrent cohost load.

## Frozen versus current provenance

- Runtime/fixture revision: `68059389bf95e03caeae6479837187add3d07814`.
- Author checkpoint: `222e9e127b5e86fa3e9af85d3bad0ee9fa54395c`.
- Frozen source Git tree: `67da7e232729bb75fc3313f80d644112558dc1fa`.
- Successful capture HEAD: `c1cc8fbb4f6c1f7931e0ea7f7f36c9707bff8e82`.
- That HEAD's source Git tree: `ba9fc40f5d12b93f09191c2380eb20fe3a5405fc`.

Every archived frozen input is authenticated against its Git blob and the
author checkpoint. The two checkpoints have identical selected runtime,
original fixture/matrix/MockDav and author-helper/control/runner bytes.

By successful capture, concurrent commits had changed
`src/commands/file/README.md`, `src/commands/file/index.ts`,
`src/commands/file/shared.ts` and `src/commands/text.ts`. Additional live changes
affected the tree command's README, arguments, I/O and implementation. Exact
frozen/committed/live SHA-256 values for every frozen input are in
`current-vs-frozen.json`; complete selected tracked diffs are preserved in
`committed-runtime.delta.patch` and `live-runtime.delta.patch`. Live hashes are
sequential observations, not an atomic worktree snapshot. These advanced/dirty
inputs are neither reset nor substituted into the frozen qualification.

`shared-readonly-before.json` and `shared-readonly-after.json` show no source,
author-subtree or existing shared-dist changes during the successful run.
Original frozen inputs, built dist and extracted package also pass final
unchanged-hash checks. This is not a claim that the overall worktree is clean.

## Exact original seals and declared delta

All nine independently reproduced SHA-256 seals equal the author's recorded
successful cohort, including the deterministic packed tarball:

| Sealed input/output | SHA-256 |
| --- | --- |
| Original complete matrix | `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d` |
| Workload/assertion body | `2d6700674dbaadd10fba3765def70a647709ed7578c10bbc2f783fe4cbac64bf` |
| Original fixture | `127a6910a2733d6b6df01285d37d5c90ccbeeeefda40e0869dc633ef8f6d14e5` |
| Configured public fixture | `6ca47426b3926125950755679dfadd8169bb19620968adf51a0ec8b92f6a34ba` |
| Original MockDav | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |
| Author helper | `70a52a3f2f8df440f6b038c19af02f2d63f79d1b4f099e934b4e2d30c23998bf` |
| Source manifest | `0bf604ee810f6ac5dd2cdf771934288fe654700f9b3f6875903592df47f314d1` |
| Complete build manifest | `693a50d3ba681bb3afc2f5f8e4ae8edf84091ed4f492935a95f2f54c5bd4a8e0` |
| Packed product | `2e33387a28f91e0d187eaab429410765bf317ff59567c9f0287aa73199d63dbf` |

The entire matrix is equal after reversing its single public-import relocation;
the body from `const digest =` onward is byte-identical without transformation.
The original fixture is copied with public import relocation. Its configured
variant adds exactly the declared helper import and
`atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href)`. Both transformations
are checked for a unique match and reversed to prove equality. No original
command workload, assertion, backend list, readonly row, preflight body or
MockDav body changes. `original-seals.json` and `import-relocations.json` preserve
the details. **Configured configuration changes inputs**; it is not unchanged-
all-inputs proof despite unchanged command workloads/assertions.

## Public package boundary and actual module closure

The consumer package is named `independent-atomic-dav-consumer`, not
`virtual-bash`. Its `import.meta.resolve("virtual-bash")` resolves to its own
extracted `node_modules/virtual-bash/dist/index.js`, as asserted in
`public-boundary.json`. Strict NodeNext declarations resolve under that installed
package, not source/self-reference. The type file lists and SHA-256 values are
in both `strict-packed-*.type-closure.json` files.

The probe initializes the actual asynchronous `agentCommands()` plugin, checks
22 required command implementations and verifies curl/SafeJS are not silently
installed. Original aggregate family dispatch assertions run unchanged in both
full matrix variants; this is not a fake registry or direct family substitute.

`observe.mjs` records actual specifier/parent/resolved URL edges and exact loaded
file hashes, including the installed root and plugin implementation. The
following successful-run logs have these exact observed counts and SHA-256:

| Run | Resolution + load events / distinct loaded files | Log SHA-256 |
| --- | --- | --- |
| Packed stock | 627 / 163 | `bfa543c29f23e7e95a453a44355336c8fe9ebac7f5d1559317e347d2c5e0135d` |
| Configured | 630 / 164 | `7300ada4c14a1a8a7fee2d2c72be821d75f5d4ebab0292c00d0a79e047f40c88` |
| Author controls | 618 / 162 | `1e1fdfceb5db53dcc9a18a772edf581fec8cf839a6efa7550cc55ce4eb634eb9` |
| Independent hidden | 618 / 162 | `c4c7ba64381c408880732f74caf12bdd383e3d43fb4602369f335ccc2177b045` |
| Boundary probe | 608 / 158 | `fd672ea6edf3f35b5b1eb54817b3b72607f6b96b88207ba208136890c4832c78` |

`module-closures.json` contains each actual file hash and mutant/restored
closures. Product imports come from the installed package. The only explicitly
allowed external-to-consumer runtime files are original MockDav bookkeeping's
frozen-built `dist/fs/webdav/resource-id.js` (SHA-256
`3dd1e43036eefe79622618599d5dbc6ad9bbffc1b6a19f251e960fb3f4d28624`)
and its existing `dist/contracts/errors.js` dependency (SHA-256
`18a4a05815e6673dff47a7ffe8caa43b9a8d3c97f67571bebb9d562b1703aa6f`).
The runner enforces their exact parent edges. This existing private Mock import
is not a new public helper API: it stays distinct from the installed product
module instance. The original matrix's HTTP bridge does not carry its private
response-ownership registration across HTTP. No product `source/src` files load
in packed runs. Full build/pack manifests cover worker files statically; these
main-hook logs are not claimed to observe every dynamic worker import. Builtin
modules have resolution records, not fabricated file hashes; the Node binary is
separately hashed. Existing dev-tool package metadata is hashed, not whole trees.

## Helper safety, actual wrappers and bounded mutation evidence

Inspection confirms the author helper receives the actual public `MockDav.files`
and `locks`, not a private resource object or duplicate fake store. It validates
canonical namespace/path/operation, checks root/type/existence/locks, examines
all descendant names and calls the existing public `files.delete(path)` once.
There is no await/yield between emptiness check and deletion. MockDav's original
Map bookkeeping methods are unchanged and continue to run through normal method
dispatch. There is no recursive DELETE, recursive removal or child deletion.

Independent controls prove immediate backing mutation before awaiting the return,
exact sibling preservation, URL-encoded/unicode path binding, existing/deep/late
child refusal for both `rmdir` and `rm -d`, exact refusal-side namespace/bytes,
namespace/operation/path/receipt guards, active/expired/prefix locks and
errno-shaped cancellation. Corrupt receipts intentionally occur after genuine
removal: EIO does not undo host effects, and no fallback DELETE occurs.

Two real public adapter clients sharing one Mock backing do not invent disjoint
identity scopes, compare the same entry as `same`, and refuse same-entry copy
without byte loss. No private identity access or custom comparison is injected.

Actual readonly and readonly-mounted adapters refuse writes with EROFS. Mount
forwards the normalized backing path, preserves prefix siblings and retains late
children. A WebDAV **upper** still has `atomicRename: false`; its overlay is
read-only and returns ENOTSUP without calling the helper. This is a negative
guard, never a positive configured-overlay success. A WebDAV **lower** with
memory upper uses local whiteouts for empty directories, leaves lower bytes
untouched and does not call host atomic removal; existing lower descendants are
not hidden by a successful nonempty removal. Later children after a completed
whiteout remain outside a transaction/lease guarantee, as in the unchanged author
controls. No capability is fabricated to make an unsupported upper writable.

Only the emitted test-helper copy or explicit test configuration is mutated;
production, the original helper, controls and mock stay unchanged. Each mutant
runs all 27 hidden tests with zero cancellation/skip/TODO, exits 1 due to actual
assertions, and retains its mutated bytes, module closure and raw failed input:

| Bounded mutation | Failed hidden rows / 27 |
| --- | --- |
| Lost configured capability | 15 |
| Ignore nonempty descendants | 5 |
| Delete descendants recursively | 5 |
| HTTP DELETE fallback at helper removal | 12 |
| Yield between check and delete | 1 |
| Delete wrong sibling target | 12 |
| Treat prefix siblings as descendants | 12 |
| Ignore request namespace | 1 |
| Return wrong path receipt | 7 |
| Ignore active locks | 1 |

All **10/10 mutants are detected**, and restoration returns **27/27**. This
finite mutation set is sensitivity evidence, not proof against arbitrary host
JavaScript, malicious Map replacements, distributed races or every possible bug.

## Canonical proposal review — root decision remains required

The proposed separate stock-negative and configured-positive profiles are a
reasonable layout only after explicit root approval, with these precise limits:

1. Preserve the original stock matrix, fixtures, MockDav, preflight, positive
   empty-rmdir expectation, raw 78/79 failure and original seals as immutable
   historical inputs. Do not silently convert the failing positive to a pass.
2. A newly named stock capability test may assert empty ENOTSUP, nonempty
   ENOTEMPTY, no DELETE and exact namespace/byte preservation. Its refusal
   denominator is separate and does not erase the old failure.
3. A newly named configured fixture may bind only WebDAV to the truthful backing
   helper; preserve every other fixture choice. A configured full-matrix runner
   needs a byte-equivalence gate against all original workload/assertion bodies,
   explicit import/config deltas and the 70-workflow/9-readonly-refusal split.
4. Do not promote WebDAV-upper overlay ENOTSUP to success or call lower whiteout
   behavior forwarded host atomic removal. Keep capability guards separate.
5. Report the mock matrix separately from real service evidence and any future
   native-semantic or performance cohorts; never merge denominators.

Nothing in that proposal is migrated here. Accepted production source
`d1174e2db9f4a4c92403842dee6fb3d4ff57ec96` and prior independent WsgiDAV acceptance
`44534900396654ac760c49e599be738a1e6cf689` /
`b22d00c2834358dc3083de58774f3aa188093f9b` remain the separate real-service basis.
This review does not rerun or expand those service claims and needs no provider
download. Root decides any canonical migration after this handoff.

## Cleanup and evidence ownership

Both attempts' `cleanup.json` files confirm removal of their own `.isolated-*`
directories, including isolated source/build, native real-adapter temp paths,
consumer package, temporary HOME and npm cache. Shared dist, installed dependency
trees, ambient/global configuration, old native artifacts, author evidence and
other workers' staged/unstaged changes are untouched. Frozen input archives,
packed artifacts and failed/successful consumer emissions remain under this
owned subtree for replay. Only this subtree is eligible for the atomic commit.
