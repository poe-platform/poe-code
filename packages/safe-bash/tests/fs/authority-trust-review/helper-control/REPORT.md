# Short helper provenance control

August 27, 2026. New audit only; the prior `7a7562fe` 48-file checkpoint and
raw history remain byte-identical. No source/contract/original-helper edits,
qualification changes or new feature tests. Collection completed without staging
or commits; root has now authorized one atomic 24-file evidence commit.

## Exact path and distinct changes

The helper is **`tests/fs/webdav/mock.ts`**, not the original test fixture.

- `a0e598b6cc023a1ee6e95cf8f67903a74e8a2b7e` introduced resource-map identities,
  requested DAV resource-id XML, private response registration, constructor
  method-table enrollment, qualified `createFetch`, and COPY/MOVE identity
  maintenance. Its parent `781f272b33288d9ffcd898d5399996a646e3c3fd` has the
  same helper as `d799cbb`. COPY preserves an existing destination resource
  identity; MOVE transfers source identity. This is the earlier provider-model
  implementation change, **not** work introduced by `8c863cd`.
- `8c863cddde7c7775bb664addbd2f08fa91845c7e` versus its parent
  `20b889b943eceb66cc396c1a615c6789898962fe` only removes imports of
  `registerMockWebDavFetch`/`forwardOwnedWebDavFetch`, removes constructor Map
  method-table enrollment, and makes `createFetch` an ordinary forwarding
  closure. It retains the resource-map/response/COPY/MOVE machinery. Its parent
  helper equals `b02bbe8` and `a0e598b`; its resulting helper equals `eab1d48`.

The two exact diffs are retained separately in `evidence/identity-introduction.diff`
and `evidence/forwarding-change.diff`. Full commit and helper/fixture hashes for
all seven historical references are in `evidence/provenance.json`.

| Helper family | SHA256 |
| --- | --- |
| d799cbb / a0 parent | `f46b18da28ed03b8096dc2b8a10fc0aba768947b9af5ebf0ebae602b289d8ce0` |
| a0 / b02 / 8c parent | `e4f8a6806c1dd6f0622cce9f3b487f530011c39b7ca95cc2543002ce4da95266` |
| 8c / fixed eab | `177f79ee640460822cfe0486c87f7cc61ac7c8b84389abe32b48ef27f4b4ef36` |

The original `compatibility.test.ts` is unchanged across every reference:
`9d11741fd9b37757046c1278fdaa00c734633bfd9a1fc58ae479415c2f5a6734`.
That does **not** mean all its inputs were unchanged.

## Frozen replay and coverage

Production stays `eab1d48a90456c1c2cdeb9289b32f1ed62429137`, contract `cd8b5c8`.
All165 original inputs reconstructed from tracked bytes match the prior freeze.
Source-set SHA256 stays
`fc3269f23944309ee92ff8ecfb3cae12654d19bdb3d8e41d26523ab54be39066`.
The baseline uses the exact fixed helper; each control swaps **only** that helper
using `apply_patch` inside one regular-file `/tmp` snapshot. No shim or changed
assertion is used. All164 other inputs and production hashes remain unchanged.

| New replay | Original cases | Positive subset | Controls | DAV positives / control | Scoped types |
| --- | --- | --- | --- | --- | --- |
| Fixed helper baseline | 43/43 pass | 38/38 | 5/5 | 14/14 + 1/1 | exit0 |
| b02 / 8c-parent helper | **0 executed** | unexecuted | unexecuted | unexecuted | exit2 |
| d799 helper | 38 pass, 5 fail /43 | 33/38 | 5/5 | 9/14 + 1/1 | exit0 |

All reported test invocations have zero skip/cancel/TODO. The b02 invocation
reports one failed **file-load wrapper**, not43 failed cases. ESM fails at helper
line3: `resource-id.js` does not export `forwardOwnedWebDavFetch`. TypeScript
TS2305 at3:10 and3:35 identifies that export and `registerMockWebDavFetch`.
New production removed both functions in8c. Old helper would require the removed
`forwardOwnedWebDavFetch(fetch)` and `registerMockWebDavFetch(fetch, storage,
valid)` interfaces, or adaptation equivalent to8c. Neither is supplied here.

Exact original WebDAV names below all pass in baseline; none execute under b02:

| Original case name | d799 control |
| --- | --- |
| REQUIRED webdav direct copy, target missing | pass |
| REQUIRED webdav direct copy, target existing | pass |
| REQUIRED webdav one-mount copy, target missing | pass |
| REQUIRED webdav one-mount copy, target existing | **fail ENOTSUP** |
| REQUIRED webdav separate-clients copy, target missing | pass |
| REQUIRED webdav separate-clients copy, target existing | **fail ENOTSUP** |
| positive webdav direct existing-target rename (default lock policy) | pass |
| positive webdav one-mount existing-target rename (default lock policy) | pass |
| REQUIRED webdav separate-clients cross-mount mv, target missing | pass |
| REQUIRED webdav separate-clients cross-mount mv, target existing | **fail exit1 / ENOTSUP meaning** |
| paired webdav opaque separate-client alias stays unchanged (traversal may reject first) | control pass |
| REQUIRED memory to-remote webdav copy, target missing | pass |
| REQUIRED memory to-remote webdav copy, target existing | **fail ENOTSUP** |
| REQUIRED memory from-remote webdav copy, target missing | pass |
| REQUIRED memory from-remote webdav copy, target existing | **fail ENOTSUP** |

All five failures preserve exact before/after file bytes and namespaces; provider
traces contain only PROPFIND. These are failed required positive workflows,
not positive credit for refusal. The other28 cases pass. Raw observations remain
in the new control TAP; no old31/38, qualified38/38, damage or acceptance record
is overwritten or relabeled. The three helper versions are distinct cohorts.

## Reproduce and limits

Run `node tests/fs/authority-trust-review/helper-control/reproduce.mjs` with a
fresh evidence directory. It refuses output overwrites, verifies prior48 hashes,
copies existing dependencies **once**, checks lock versions and the entire318-file
dependency hash against the earlier verified snapshot, then runs three exact
full-fixture invocations and three scoped typechecks. Exit0 from the collector
means capture completed; use the recorded per-command statuses above, not the
collector exit, for acceptance. Each child is bounded to120 seconds/4 MiB per
output stream. Commands, names, counts, hashes before/after, current-moving status
and cleanup are recorded. Relative imports resolve exclusively into fixed source;
Real fixtures live under `/tmp`. Owned snapshot/dependencies/fixtures are removed.

The control shows why unchanged-fixture language must not imply unchanged-helper
inputs. It does not isolate8c's functional contribution by adapting the incompatible
old helper, reopen trusted-host semantics, validate future HTTP/constructor-callback
code, or claim arbitrary-provider/whole-FS acceptance. No further breadth pursued.
Commit-ready new paths and hashes are in this subdirectory's `MANIFEST.sha256`;
nothing was staged during collection. Collection detail:
`/tmp/safe-bash-helper-provenance-detail.txt`. The authorized commit receipt is
`/tmp/safe-bash-helper-provenance-commit-detail.txt`.
