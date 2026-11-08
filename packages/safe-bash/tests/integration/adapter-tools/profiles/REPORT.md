# Canonical rmdir reconciliation: author evidence and handoff

## Checkpoints

- Before-edit archive: `d206c17bf3019971d619fdad6b42382cfeb84b3b`, recorded before
  changing either canonical TypeScript file. The earlier read-only brief's HEAD
  is not mislabeled as this later checkpoint.
- Precommit validation: committed product `02704bd1291b83763d7360b97bc5c6d50403ad10`
  plus explicitly enumerated uncommitted owned test inputs. See
  `evidence/precommit-first/`; this is not committed-candidate evidence.
- Clean source/harness/archive commit: `3bf672f722da2bdf1591ed112290b702987bf63a`.
- Committed-input evidence: `evidence/committed-author/`, same revision, with
  `worktreeTests: false` and passing `gate.json`. Product source Git tree:
  `782cbec72259112e0810f9d6d9d55f2e7f37992f`.

Final capture began August 27, 2026 at 10:03:53 UTC; cleanup completed at
10:04:05 UTC. These are execution timestamps, not a performance comparison,
whole-release gate or claim to satisfy the separate 72-hour requirement.

## Exact implemented delta

Only two preexisting TypeScript files change:

1. `../matrix.test.ts`: add the selector import; explicitly label the existing
   WebDAV lifecycle row `webdav configured atomic-empty`; use `withRmdirFixture`
   for that lifecycle template. Its four original command/assertion lines remain
   byte-identical, including the complete chained `rm`/two `rmdir`/absence check.
2. `../fixtures.ts`: add the optional test-local binding-factory type/options;
   forward the fourth, default-empty profile argument into WebDAV construction;
   supply `atomicEmptyDirectory` only when that factory exists.

`rmdir-fixtures.ts` configures only the WebDAV positive lifecycle row. The other
five backends retain their original fixture inputs; the selector additionally
asserts the existing S3 `snapshotRmdir === true` capability. All other 78 matrix
workloads/assertions are retained. `equivalence.json` verifies the complete
canonical files against the archived originals with an exact transformation
inventory; undeclared textual edits fail validation.

`stock-webdav-capability.test.ts` adds two default-stock refusal rows, for empty
ENOTSUP and nonempty ENOTEMPTY. Each verifies direct typed FsError code/path/
syscall, actual aggregate `rmdir` and `rm -d`, exit status/stdout/exact diagnostic
consistency, complete visible namespace/backing child bytes, and no HTTP DELETE.

Actual helper diff is **empty**: the accepted `atomicMockBinding` is imported,
not copied or edited. MockDav and private resource bookkeeping are unchanged.
Readonly/mount/overlay inputs and capabilities remain unchanged. S3's positive
workflow is quiescent snapshot-marker behavior, not atomic emptiness; marker
success need not establish absence under a late child. No fabricated atomicRename,
recursive fallback, skips, xfails, duplicate full-matrix registration or new API.

## Actual separate counts

Both precommit and committed-input cohorts produced these counts. All have zero
failures, cancellations, skips and TODOs; the precommit label remains distinct.

| Cohort | Passed/tests | Denominator meaning |
| --- | --- | --- |
| Targeted source stock refusals | 2/2 | Subset also included in canonical81; not extra canonical coverage |
| Full canonical source | 81/81 | 70 workflow/behavior + 9 readonly refusals + 2 stock WebDAV refusals |
| Full canonical packed consumer | 81/81 | Same 70 + 9 + 2; not 81 positive mutations |
| Historical full configured workloads on current packed product | 79/79 | Original 70 workflow/behavior + 9 readonly refusals; distinct changed-config profile |
| Existing author controls | 22/22 | Separate guard/wrapper/late-child controls |
| Independently authored controls, replayed by author | 27/27 | Separate late-child/lock/namespace/receipt/backing/wrapper controls; not fresh independent approval |

The frozen source build, strict source check, strict packed-canonical check,
strict packed-historical check, offline npm pack and public boundary probe all
exit 0. Strict checks retain actual `--listFiles` output, covering canonical
tests/helpers and the materialized historical TypeScript plus imported closure,
not merely a proposed consumer inventory. The `.mjs` runner passes syntax check.

The historical configured79 replay materializes the archived original matrix and
fixture in a separate package under the consumer. It changes only public import
wiring and the same explicit WebDAV binding. It does not run another canonical
matrix registration, and does not convert old stock78/79 evidence into a pass.

## Exact SHA-256 hashes

| Item | SHA-256 |
| --- | --- |
| Current product input manifest | `662bc73b335540afb0fc79ccada3a539c0775f9897e2e3322800293979269255` |
| Original full matrix | `14d9150068fa2b28acd671b6077e56b08c7565840c1760af9387cb5dbba2030d` |
| Original full fixture | `127a6910a2733d6b6df01285d37d5c90ccbeeeefda40e0869dc633ef8f6d14e5` |
| Original full positive row | `1b6bec20f3a9cae1f04ed30f8e21f758e5ba72d48715dc5c18e4770c310fe0ba` |
| Unchanged positive command/assertion body | `81ca50e611045a348db5954c53b26762da66ff4ba2c4af530349601f8d910b5e` |
| Full historical workload/assertion section | `2d6700674dbaadd10fba3765def70a647709ed7578c10bbc2f783fe4cbac64bf` |
| Reconciled canonical matrix | `616f099aabda4353b53fd1cc2a9137e71bdc611b831e9120ad93f5432d0dbe22` |
| Reconciled canonical fixture | `d1fcd360170a9ea5467697fa5a1bc64e53f5589ad376ddd3c01aa65cf119729f` |
| Historical configured fixture before public import relocation | `dc84f00a496ffbd730f90799f85b1df5c0f9c143a0a413bd114a4e82cc3f5838` |
| Unchanged MockDav | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |
| Unchanged atomic helper | `70a52a3f2f8df440f6b038c19af02f2d63f79d1b4f099e934b4e2d30c23998bf` |
| Packed product | `886abaa12224883a4c6efe728347e06fa1b17965b756b37f1dba1bea2f1d245f` |
| Generated build manifest | `ccc2139f2274fc76afac06eb1674d80b5a4cc4098d56cb269a1dc96ba603b196` |

Per-file hashes/blobs are in `inputs.json`, `product-inputs.json`, `built.json`,
`packed.json`, and `consumer-inputs-and-outputs.json`. `summary.json` records the
342/169/169/171 observed runtime load entries for canonical/author-controls/
independent-controls/historical-configured respectively. These are observations,
not distinct coverage counts or a claim to instrument all worker imports; full
built/packed manifests additionally cover worker files.

The consumer is `adapter-rmdir-canonical-consumer`, not `virtual-bash`; its
resolved product is its installed `node_modules/virtual-bash/dist/index.js`.
The probe initializes actual `agentCommands()` and checks all 22 original
preflight-required commands. Runtime logs verify installed index/plugin loads,
file hashes, and no product `source/src/` load in packed cohorts. The original
Mock's existing response-bookkeeping import alone is relocated to frozen built
resource-id support; this is disclosed fixture wiring, not new private identity
logic or a public product API. The historical consumer uses the same installed
package under a separately named package boundary.

## Preserved evidence, data and cleanup

Old author and independent stock78/79/configured79/79 artifacts and seals,
preflight, Mock source and atomic helper are unchanged. Before/after read-only
diff checks cover those paths. No new failures occurred in these two captures;
raw stdout/stderr, commands, statuses and input bytes are retained for both.

`history/*.ts.txt` and `evidence/*/inputs/**/*.txt` are explicitly classified
captured input **data**, not canonical TypeScript or test-discovery inputs.
Captured configured fixtures also end `.ts.txt`; archives are binary data.
Canonical `.ts` files are not excluded, and historical inputs are actually
materialized and strictly compiled during their scoped replay. No `.mts` files
or root compiler/test-discovery changes are introduced.

Both `cleanup.json` records confirm their owned `.isolated-*` directories were
removed, including real-backend roots and npm cache. No incidental native
artifacts or other workers' changes were cleaned. Existing dev tools were reused;
no dependency install, provider download, root `dist`, root config/manifest,
exports/contracts, production, timestamp fixture or private checkout was edited.

## Independent review and authenticated-service boundary

This is author evidence. Fresh independent verification is still required after
source checkpoint `3bf672f`; replaying the prior independent tests here does not
meet that separate requirement.

```sh
node tests/integration/adapter-tools/profiles/verify.mjs independent-review 3bf672f722da2bdf1591ed112290b702987bf63a
```

Review the declared two-file delta, archive/body equivalence, selective binding,
stock refusals, S3 weaker-profile assertion, packed load boundary and independently
stress the negative controls. Record new findings in new evidence, not by editing
old seals. The exact replay pins this source revision; any newer candidate must
be explicitly frozen and measured rather than inheriting these counts.

Authenticated WsgiDAV 4.3.5 extension evidence at `b22d00c` remains the independent
historical service basis (`tests/fs/webdav/atomic-extension-independent/phase2/`).
No server or whole-provider cohort was downloaded or run here. Mock refusal,
late-child, lock, namespace and receipt results do not prove authentication or
certify current real-provider interoperability. No universal parity, superiority
or full-release completion is claimed.
