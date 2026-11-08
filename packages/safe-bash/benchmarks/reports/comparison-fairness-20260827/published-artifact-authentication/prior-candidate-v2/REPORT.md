# Published just-bash3.4.2 artifact authentication

August27,2026 UTC. Accepted prior evidence:245799e7498c849098ca971fe00270112aa5e06e.

## Status

**Offline artifact proof passes:** the actual pinned official tarball matches
registry SHA512 SRI/SHA1, and all955 published file paths and bytes match the
installed baseline in the retained comparison freeze. The formerly unverified
tarball-content link is now demonstrated for this package, subject to the separate
reviewer's acceptance. This does not authenticate all transitive dependencies,
registry signatures, source-build provenance or every historical module evaluation.

**Representative execution has NOT run.** Root approval of the exact sealed
seven-ID/eight-call proposal is still required. The driver and observers are
authored and syntax-checked only. No successful IPC/entry-import/lifecycle result
is invented from their unexecuted code. Independent reviewer owns `verification/`;
this leaf has not written there or staged/committed anything.

## Actual download

The bounded downloader observed both HTTP200 responses over authorized TLS1.2:

- Metadata: `https://registry.npmjs.org/just-bash/3.4.2`, completed
  **2026-08-27T05:49:41.241Z**,8127 bytes, retained byte-exact in
  `registry-metadata.raw.json`.
- Tarball: `https://registry.npmjs.org/just-bash/-/just-bash-3.4.2.tgz`, completed
  **2026-08-27T05:49:41.625Z**,**9,879,070 bytes**, retained only in
  `/private/tmp/safe-bash-published-auth-JydnQ4/just-bash-3.4.2.tgz`.

| Actual compressed artifact digest | Result |
|---|---|
| SHA512 SRI | `sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==` |
| SHA1 | `abc0520ad5c278eae2de4cd90c3d7f88e1fdd724` |
| SHA256 | `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d` |

SHA512 and SHA1 equal `dist.integrity` and `dist.shasum` in the actual captured
metadata; SHA256 is an additional custody hash. `download.json` contains the
actual SHA512 hex too, exact URL/time/body hashes, status and Node `rawHeaders`
name/order/value arrays, parsed headers, requested headers and TLS peer evidence.
This is HTTP-client header capture, not an independently captured raw TLS wire
transcript. No redirect occurred. Signatures/attestation URLs remain metadata,
not independently verified publisher attestations.

Transport uses `node:https`, no npm/install, proxy/profile or ambient credentials:
scrubbed `env -i`, owned HOME/TMPDIR/npm cache, direct nonpooled TLS requests,
certificate verification, HTTPS443 and `registry.npmjs.org` allowlist at every
hop, at most3 redirects, metadata2MiB/tarball16MiB,30s/request and90s total ceiling.
The first environment preflight rejected macOS-added `__CF_USER_TEXT_ENCODING`
before networking; the corrected preflight removes only that platform variable
before enforcing the original allowlist. The failed attempt remains recorded.
No package scripts, runtime imports, upgrades or external writes were performed.

## Independent extraction and full comparison

`extract.py` uses Python stdlib gzip/tarfile inspection, **not product extraction
code or extractall**. Decompression is bounded at64MiB. It validates all effective
members before publishing into a new owned directory: `package/` containment,
no traversal/absolute/backslash/control paths, duplicate/casefold/ancestor
collisions, links, sparse/special files, or nonzero trailing archive content.
Regular payloads use exclusive nonfollowing writes; archive ownership and unsafe
mode bits are not applied. There are955 regular members, **22,583,023 file bytes**,
matching registry `fileCount` and `unpackedSize` exactly.

`published-files.json` and `package-comparison.json` retain every path/byte count/
SHA256 and membership comparison. No extra installed file or missing published
file was waived as bookkeeping. All955 compare equal to the existing
`/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product/benchmarks/node_modules/just-bash`
and its sealed per-file hashes. The entire package.json is byte-identical;
nine selected semantic fields also match the captured registry manifest.

Fifteen owned synthetic archive guard cases pass, including14 rejected unsafe
cases and one positive regular archive. A subsequent full guarded re-extraction
after strengthening casefold-ancestor checking has the identical955-file map.
These are offline extractor checks, **not product benchmark calls**.

A separate execution closure in owned `/tmp` contains3842 regular files/
135,300,567 bytes: only frozen development/benchmark dependencies, selected
unchanged profile helpers and package/config/lock files. Its just-bash package is
copied from the independently extracted authenticated archive, **not from the
installed baseline**. No product `src/` or private runtime is copied. Final checks
prove all955 package files are regular, single-link and distinct inodes across
extracted/frozen/copied roots, with equal bytes, and rehash the complete3842-file
closure. No tarball/dependency implementation is vendored into this repository.

## Locks, dependencies and modes

- Frozen main development tree:318 files; copied-tree hash
  `034616cb714d6a1fd47b982208ddc8df95e61bb43cbb4ce0a7af50ad2be6e797`.
- Frozen benchmark tree:3510 files; copied-tree hash
  `1bac5a42b755ba5909692232d04bb7ba46c9d37f4d1a6288c5a6fa0fff6e050c`.
- Both file membership/bytes match their sealed maps. Main lock SHA256
  `9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`;
  benchmark lock SHA256
  `6aad93176a9f7fc2578dd720802ce93a1e71b3be9dd9052ef0a54fab8bdc7d70`.
  The frozen main lock and accepted benchmark lock match recorded freeze hashes.
- Installed hidden-lock/manifests reconcile7 main packages and81 benchmark
  packages against their respective lock versions/integrity strings. Main lock
  has33 entries including its root, with25 not in the installed hidden lock;
  benchmark lock has82 including its root. Uninstalled platform/optional nodes
  are not passes. Main runtime dependencies remain empty in the frozen graph.
- Only **just-bash's955 files** are publisher-artifact authenticated here. All
  other dependencies/tooling/optional assets are byte-tree-equal and lock-pinned,
  not independently authenticated against each publisher's tarball. Full graphs,
  hashes and per-file checks remain in the corresponding JSON evidence.

Physical modes differ from the recorded pre-seal maps for all3828 dependency
files: write bits were removed. This is explicitly explained by retained
`prepare.mjs:116`, which seals files read-only after recording their original
modes. The new closure preserves actual0555/0444 modes; the original freeze is
not modified. Initial mode-sensitive and copied-tree reconstruction assertions
are retained as offline failed attempts. Copied-tree hashing must null source
`originalSymlink` metadata because the frozen copy dereferences links; both
copied-tree hashes recompute exactly with that documented representation.

## Measured entry and no local replacement

Authenticated `dist/bundle/index.js` SHA256 is
`70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c`;
package.json SHA256 is
`b49c28900fe0640b12b9f9e9bb45feebbfa1e94b1a03b0ba7e076a0cb548f3fd`.
Both and the benchmark-lock hash equal the historical expanded run's recorded
identities. That older report did not provide equivalent full transitive-tree
authentication; this audit does not invent it retroactively.

Both exact frozen engine modules match their Git versions and seals. They import
`baselineRoot/dist/bundle/index.js`, the published Node ESM entry, then construct
real `Bash`/`InMemoryFs`. No `customCommands` or alternate command definition is
supplied. The measured registry instrumentation shallow-spreads each existing
definition and records argv before forwarding directly to its original execute
function. This known observation wrapper is disclosed, not silently described as
an untouched registry. No local stub/replaced package file is present relative to
the official tarball. Upstream's own diagnostic stubs or bugs are not denied.

Retained original and aligned import logs each contain442 authenticated package
load-attempt events across125 unique package paths, including the entry in14
PIDs. Every logged package hash matches the published archive. Complete bundled
chunk/worker/asset identities are authenticated through the full package map;
published inclusion does not prove every optional worker/data asset executed.

**Load attempt is not module evaluation.** The old loader logs before nextLoad;
the original ready/request/PID/recipe ledger was not retained. Exact engine code
emits ready only after awaited entry import returns, and completed observations
support bounded entry use by control-flow inference. Existing CAPTURE-LIMITS.md
qualifications remain intact. No universal successful-module-evaluation or
historical all-normal-child-exit claim is made.

## Approval-gated representative proposal

`representative-plan-v2.json` binds the exact existing inputs, native expectations
and previous baseline observations. `/tmp/safe-bash-baseline-auth-plan.txt` is the
root-facing proposal. Original version is retained separately.

| Profile | Existing ID | Expected old baseline result |
|---|---|---|
| original | command/echo/multiple | pass |
| original | composition/archive-hash/archive-hash | pass |
| original | command/cat/binary-stdin | fail stdout |
| original | network/curl/get | fail stdout |
| original | network/curl/output | pass |
| original | kernel/type/type | pass |
| original | command/patch/dry-run | fail stderr/status/entries |
| aligned | command/patch/dry-run | fail stderr/status |

Exactly8 baseline calls/8 fresh sequential children/1 coordinator,7 distinct IDs,
no ours/empty initialization/warmup/neutrality/transport-control/inventory/native/
performance/full224 calls or retries. Only the scratch-sensitive dry-run repeats
across profiles. The prepared driver uses exact unchanged engine/recipes/
comparator/server helpers, instrument=true and warmup0. It proposes a loopback-only
server and request/ready/settlement/cleanup ledger. Parent disconnects IPC after a
result; it sends **no unsupported stop message**. Natural-exit grace precedes
explicitly recorded cleanup signals. A forced exit remains a lifecycle failure.

New observer code logs resolve/load-attempt/load-return; it additionally forbids
child_process APIs beyond the declared worker budget. This is a disclosed
containment difference from the prior observer, not a command replacement. Any
attempt becomes an infrastructure/budget failure and stops the subset. None of
this driver behavior is runtime-validated yet; only syntax checks ran.

Root must approve exact driver/observer/input/closure/text-plan hashes before
`representative.mjs --approval /tmp/safe-bash-baseline-auth-approval.json` may run.
No approval file is authored by this leaf. The independent reviewer receives
the code and offline proof first; this is not final behavioral acceptance.

## Preserved results and handoff

Existing scores remain **original222/224**, **aligned223/224** versus baseline
**155/224** in each profile. They refer to the same dirty integration source tree
`76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`, captured at
HEADc2902a6 **plus dirty/untracked source**, not a clean/current HEAD. No denominator
union, baseline-only combination, full parity, speed or superiority claim follows.

Authored scripts reproduce the bounded first-run workflow using existing Node/
Python stdlib only; output creation is exclusive to preserve earlier attempts.
For a separate reproduction use a fresh owned report/temp destination, never
overwrite these raw captures. `final-offline-check.mjs` rehashes retained inputs
without product imports. `handoff-manifest.json` identifies final author files and
proposed approval hashes, excluding reviewer-owned verification/. Old evidence,
including the14 accepted raw-whitespace findings, remains untouched.
