# Configured atomic WebDAV matrix: measured author handoff

## Frozen checkpoint and actual results

Successful cohort: `evidence/author-corrected`, frozen committed revision
`68059389bf95e03caeae6479837187add3d07814`. Product source Git tree:
`67da7e232729bb75fc3313f80d644112558dc1fa`.

The final subprocess sequence ran on August 27, 2026 from 09:02:26 UTC through
cleanup at 09:02:36 UTC. These are recorded execution times, not a claimed work
duration, benchmark or fulfillment of the separate 72-hour requirement.

| Cohort/check | Measured result |
| --- | --- |
| Original stock matrix, unchanged frozen TS inputs | 78/79; one expected stock WebDAV empty-rmdir failure |
| Packed public-consumer stock matrix | 78/79; exactly the same failing row |
| Packed configured full matrix | 79/79 |
| Separate stock/profile/wrapper controls | 22/22, excluded from matrix positive denominator |
| Frozen source build | exit 0 |
| Strict original-input typecheck | exit 0 |
| Strict packed-consumer stock typecheck/emission | exit 0 |
| Strict packed-consumer configured typecheck/emission | exit 0 |
| npm pack and installed public resolution | exit 0; 22 required aggregate registry commands executable |

Each test cohort has zero cancelled, skipped and TODO cases. Both stock runs fail
only `webdav: create, copy, append, inspect and remove files`. The configured
matrix retains all original memory, real, S3, WebDAV, mount and overlay workloads,
and original readonly rows. No original positive assertion was migrated.

This is **changed fixture configuration**, not unchanged-all-inputs proof. The
complete original matrix body from `const digest` onward is byte-identical in
both public copies. Public import relocation is recorded separately. The sole
semantic fixture change is `atomicEmptyDirectory: atomicMockBinding(dav,
baseUrl.href)`, with its import. The helper operates synchronously on the existing
MockDav public backing map and preserves the original Mock sources.

## Exact hashes

SHA-256 values (Git tree above uses Git's object hash):

| Input/output | SHA-256 |
| --- | --- |
| Source manifest | `0bf604ee810f6ac5dd2cdf771934288fe654700f9b3f6875903592df47f314d1` |
| Original complete matrix | `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d` |
| Command workloads and assertions | `2d6700674dbaadd10fba3765def70a647709ed7578c10bbc2f783fe4cbac64bf` |
| Original stock fixture | `127a6910a2733d6b6df01285d37d5c90ccbeeeefda40e0869dc633ef8f6d14e5` |
| Configured public fixture | `6ca47426b3926125950755679dfadd8169bb19620968adf51a0ec8b92f6a34ba` |
| Original MockDav | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |
| Atomic helper | `70a52a3f2f8df440f6b038c19af02f2d63f79d1b4f099e934b4e2d30c23998bf` |
| Packed product tarball | `2e33387a28f91e0d187eaab429410765bf317ff59567c9f0287aa73199d63dbf` |
| Complete generated build manifest | `693a50d3ba681bb3afc2f5f8e4ae8edf84091ed4f492935a95f2f54c5bd4a8e0` |

`summary.json` contains exact hashes of the 163/164/162 runtime load-log entries
for packed stock/configured/controls respectively. The logs include loaded
installed `virtual-bash/dist/index.js` and `dist/plugins/index.js`. No product
`source/src/` module was loaded by those packed runs. The original MockDav's
existing private response bookkeeping import is explicitly relocated to the
frozen **built** resource-id module; it is not a new private API or helper hack.

The consumer package is named `atomic-webdav-profile-external-consumer` and
resolves `virtual-bash` under its own `node_modules/virtual-bash/dist/index.js`.
It executes the actual aggregate `agentCommands()`. The source build and packed
files are fully hashed; runtime hook coverage is not claimed to include every
worker import. Existing development dependencies were reused, not installed.

## Failures retained and limits

- `author-first`, revision `d1de554e2756e4437a7220feeeab86a1b8664372`: stock
  78/79, configured 79/79, controls 18/20; incorrect author expectations for
  overlay WebDAV upper and an early aggregate-registry probe are retained raw.
- `author-final`, revision `b2ecb594b766b13c143cc4cfec51cb245d1817da`: stock
  78/79, configured 79/79, controls 20/22; its misleading cohort name is not a
  passing claim. Exact missing-ancestor errno-path expectations were corrected
  in the next committed test version, without relaxing code or path assertions.
- `author-corrected` has `gate.json` with `status: passed`. All three cohorts
  retain their original inputs, stdout/stderr/results and package artifacts.
- Real WsgiDAV 4.3.5 auth/locks/late-child proof at `4453490` / `b22d00c` remains
  independent service evidence. This author did not rerun it. Mock matrix scores
  establish neither real interoperability nor stock/universal WebDAV support.
- Actual readonly wrappers block the capability. Mount forwards it and preserves
  late children. WebDAV upper cannot make an overlay writable because its
  `atomicRename` capability is false: ENOTSUP and no helper call are asserted.
  WebDAV lower plus memory upper removes only the overlay view with a whiteout,
  preserving lower namespace/bytes and never calling the host atomic remover.

## Proposed canonical layout — not implemented

After independent verification and **explicit ROOT approval**, use these separate
names under `tests/integration/adapter-tools/`:

1. Keep `matrix.test.ts`, `fixtures.ts`, the original preflight and Mock inputs,
   plus their committed historical archives/raw failures, as the original stock
   cohort. Do not rewrite their positive assertion to erase the stock failure.
2. `profiles/stock-webdav-capability.test.ts`: canonical negative capability row
   for ENOTSUP on empty, ENOTEMPTY on nonempty, no DELETE and exact child/namespace
   preservation. Report this negative denominator separately.
3. `profiles/configured-atomic-webdav.ts`: explicit host-bound configured fixture
   factory. Keep ordinary backend setups identical; only WebDAV gets the truthful
   atomic binding. Place its test-only helper alongside it and label Mock backing.
4. `profiles/configured-matrix.test.ts`: generate or register the complete original
   row bodies with a byte-equivalence gate, using the configured fixture factory.
   Report its positive 79-row denominator independently from stock negatives.
5. Keep independent deployed-provider tests in their existing service evidence
   subtree, not behind a mock score or a merged denominator.

This is a proposal only: **no migration or original assertion change before ROOT
approval**. The current bounded implementation remains entirely in this subtree.

## Different-verifier handoff and cleanup

The resumed wrapper/matrix author performed these measurements. A **different
verifier** must independently inspect and stress the clean author checkpoint;
no independent approval is claimed or delegated by this author.

Replay the measured committed inputs into a new evidence directory:

```sh
node tests/integration/adapter-tools/atomic-webdav-profile/verify.mjs independent-replay 68059389bf95e03caeae6479837187add3d07814
```

Suggested independent checks: verify frozen archives/import-only relocation and
workload hashes; inspect the real public Map binding/no-yield deletion; stress
late children, namespace mismatches, active locks and cancellation; verify no
recursive DELETE and honest wrapper restrictions; confirm actual packed public
resolution and aggregate dispatch. Do not edit production or original evidence.

All three `cleanup.json` files confirm removal of their owned `.isolated-*`
directories, including native real-backend scratch and npm cache under them.
No root `dist`, dependency tree, original matrix input, existing native artifact,
production API, root export, contract, manifest or other worker path was edited
by this author. Concurrent outside-subtree changes remain untouched; clean here
means the committed owned subtree, not a falsely clean repository-wide worktree.
