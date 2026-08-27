# Atomic WebDAV configured adapter-tool profile (author checkpoint)

Ownership is only this new subtree. Production APIs, exports, contracts, manifests,
the original matrix, fixtures, preflight, MockDav and historical evidence remain
unchanged. This is resumed matrix/wrapper **author** work, not independent review.

Measured successful checkpoint: see `AUTHOR_HANDOFF.md` and
`evidence/author-corrected/gate.json`. Original/packed stock each measured 78/79,
configured full matrix 79/79, and separate controls 22/22; earlier failures remain.

## Exact fixture delta

`verify.mjs` freezes a committed revision and first builds it, strictly checks the
original matrix inputs and replays the original matrix without editing any input.
It then packs that build and extracts it beneath a differently named consumer
package. There is no install, new dependency, ambient host provider or root build.

The packed stock and configured copies relocate imports to public `virtual-bash`
exports. All matrix text from `const digest` onward, including every original
command workload and assertion, is byte-identical and hashed. Original MockDav's
body remains unchanged; its existing internal response-ownership registration
import points to the frozen build, solely for the original mock's bookkeeping.
It is not a new identity implementation or product consumer API. The matrix still
uses its original loopback HTTP bridge, which does not forward that private
response ownership. The helper never accesses private identity state.

The only semantic fixture delta is one import and one WebDAV option:

```ts
import { atomicMockBinding } from "./atomic-webdav-profile/atomic-mock.js";
atomicEmptyDirectory: atomicMockBinding(dav, baseUrl.href),
```

`atomic-mock.ts` receives MockDav's **public, actual** `files` and `locks` backing
objects. It checks the canonical `/dav/` namespace and normalized path, rejects
root/files/missing/nonempty/actively locked entries, and invokes the public
`files.delete(path)` only after checking all descendants. Check and single-entry
deletion execute synchronously with no await/yield; ordinary mock Map method
dispatch preserves the existing mock's bookkeeping. It does not monkey-patch a
Map, create private/fake identities, issue DELETE, delete children, recursively
remove anything, or list over HTTP then delete. This atomicity is limited to this
single-process in-memory fixture; it is not a distributed service guarantee.

## Evidence boundaries and replay

Run from this repository, after committing implementation:

```sh
node tests/integration/adapter-tools/atomic-webdav-profile/verify.mjs author-final FULL_COMMITTED_SHA
```

Each new cohort is exclusive-create, archives committed inputs, hashes sources,
mock/config/workloads, preserves stdout/stderr/results including failures, runs
strict NodeNext scoped checks, and records packed public runtime module hashes.
The original six writable backends and readonly rows remain in both full matrix
variants. Actual `agentCommands()` and original family preflight are retained.
The packed consumer name and resolved installed export prove no self-reference.
Only runner-created scratch inside this subtree is removed; cleanup is recorded.
Existing local development tools are used and version/package metadata hashed,
not their full trees. Runtime load logs cover file-backed ESM modules inside the
isolation; built worker files are additionally covered by the complete build and
pack manifests, not claimed to be all dynamically observed by the main hook.

Expected stock 78/79 and configured 79/79 are **targets until actual measurement**.
The 22 separate controls are not added to either positive matrix denominator.
They cover stock ENOTSUP/no-child-loss, namespace/path/receipt guards, actual
backing effects, active locks/cancellation, nonempty and late children without
recursive DELETE, and actual readonly/mount/overlay propagation. Invalid receipt
tests intentionally corrupt receipts *after* real removal and assert the effect
is not undone. Their mock controls run in-process, separately from matrix HTTP.

`author-first` preserves the first raw measurements: original and packed stock
78/79, configured 79/79, controls 18/20. The two control failures exposed an
incorrect author expectation: WebDAV has `atomicRename: false`, so overlay with
WebDAV **upper** advertises read-only and rejects mutations with ENOTSUP before
calling the atomic helper, even when configured. Corrected controls assert that
actual restriction; no production change or capability fabrication is made.
The former unreachable overlay-late-child test is replaced by a mount forwarding
late-child test, and two WebDAV-**lower** overlay controls demonstrate local
whiteouts with untouched lower storage, not forwarded host removal. Separately,
the first public resolution probe inspected the registry before asynchronous
plugin setup; it now executes `:` before the same required-command checks.
The original positive matrix assertions are unchanged throughout. All first-run
logs, input archives, pack and failures are retained, not replaced by correction.

The next cohort named `author-final` was **not a passing final gate**: it retains
20/22 controls and a `failure.json`, alongside 78/79 stock and 79/79 configured.
Its two new lower-overlay checks expected the leaf lookup path on ENOENT, but
overlay resolution correctly reports the first missing (whiteouted) ancestor,
`/empty`, for `stat("/empty/later")`. The correction asserts exactly ENOENT and
`/empty`; it does not loosen diagnostic matching or alter any original assertion.
Both lower bytes and local whiteout visibility remain checked. Later successful
cohorts require `gate.json`; a cohort directory name alone is not a success claim.

Accepted configured production profile `d1174e2` and independent real WsgiDAV
4.3.5 auth/locks/late-child evidence `4453490` / `b22d00c` remain separate service
evidence. This mock score neither reruns nor expands that interoperability claim,
and does not establish stock WebDAV support, universal parity or superiority.

## Proposed canonical layout — ROOT approval required

1. Retain the original stock matrix and fixture as immutable historical failure
   inputs, including the positive empty-rmdir assertion and original raw 78/79.
2. Add a separately named stock-capability negative row asserting empty ENOTSUP,
   nonempty ENOTEMPTY, no DELETE and exact namespace/child-byte preservation.
3. Add a configured-positive fixture profile running the shared, unchanged
   original command workloads/assertions across all six original backends; label
   the WebDAV host atomic binding and exact mock/service backing explicitly.
4. Report stock negative controls, configured positive matrix and independent
   real-service cohorts separately, never combine their denominators.

**No canonical fixture/assertion migration before ROOT approval.** A different
verifier must replay the clean author checkpoint, inspect backing atomicity and
public resolution, and stress it independently; this author cannot supply that
independent gate.
