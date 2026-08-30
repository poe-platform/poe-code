# Future comparison: provenance and prerequisites only

2026-08-27. Leaf ownership is this `provenance/` directory and `/tmp` only.
Curie owns root 68-to-70 integration, pending inventory and a different-agent
packed review. **No new frozen candidate or comparison execution is authorized.**
Nothing here changes root/source/private code, installs or downloads anything,
imports a product engine, runs a comparison case, or conducts timing trials.
Nothing is staged or committed; root review is required.

## Delivered evidence and trust boundary

- `INPUTS.json`: 28 exact evidence-file hashes, their Git commits, 138 native
  prerequisite records covering 78 distinct paths, and future required inputs.
  The primary records were checked against actual `git show COMMIT:path` bytes
  before use. The checker subsequently checks those pinned bytes without Git.
- `INVENTORY.json`: machine-generated actual file hashes, availability, expected
  identities, package membership, profile separation and explicit blockers.
- `UNAVAILABLE.json`: compact blocked/unresolved inventory, not a skipped-test
  or passed-test list. No broad cache, private checkout or native-fixture search.
- `NATIVE_VERSIONS.json`: six managed, literal `--version` children and cleanup
  accounting. Other native version strings remain captured historical metadata,
  corroborated by matching executable bytes, not newly executed version calls.
- `AUDIT_ATTEMPTS.json`: exact retained attempt paths/hashes and corrections.
  `INPUTS-before-node-cap.json` preserves the configuration used for version
  probes. Only the hash-reader per-file cap changed afterward.
- `MANIFEST.json`: hashes of this delivery, excluding the manifest itself.
  The `/tmp/safe-bash-current-comparison-provenance-detail.txt` handoff embeds the
  complete inventory and hashes; no package implementation is copied here.

`VERIFIED_BYTES` is a local content-identity observation, not a semantic test,
publication attestation for every dependency, release approval, or a lease on
mutable files. No full supply-chain, current-version or latest-release claim is
made. A future owner must recheck availability and hashes immediately before
any authorized copy/load. The checker memoizes identical path/policy reads within
one invocation; tree membership is checked before and after, but this is not an
atomic filesystem snapshot or an adversarial host-JavaScript sandbox.

## Primary published-package chain

The primary authority is commit
`010411eff3dd210b9575e061914efccd65c13547`, under
`benchmarks/reports/comparison-fairness-20260827/published-artifact-authentication/`.
The accepted older replay is commit
`245799e7498c849098ca971fe00270112aa5e06e`, under
`benchmarks/reports/current-integration/comparison-replay-20260827/`.
Do not replace this chain with a manifest version string, lockfile SRI alone,
the older installed-entry hash, or an assumption that a cache still exists.

The retained primary `download.json` records two HTTP 200 responses over
authorized TLS 1.2 to the official npm registry, without redirects. This audit
does not repeat that network operation. Its raw metadata body is 8,127 bytes,
SHA256 `ef19c2318535bde2774c58b2ab7501178b6227e8cba98071bcb0ebdcc69d84b1`.
The actual retained 9,879,070-byte tarball was rehashed:

| Identity | Actual, matching primary record and user pin |
| --- | --- |
| Tar SHA256 | `f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d` |
| Tar SHA1 | `abc0520ad5c278eae2de4cd90c3d7f88e1fdd724` |
| Tar SHA512 | `4f4569cbb6118028f125da86ded9319f46672032c9bd5c1bf211f82fee8d55da7e4dedbb8d0c63c67b335bd3838c429b5b15ae8e3f37acfe52d06431092b9f82` |
| Node ESM entry SHA256 | `70dd1320d921b736e965b1545e50ab57af2b2807a26de7fa624d4f519a953b7c` |
| Whole package.json SHA256 | `b49c28900fe0640b12b9f9e9bb45feebbfa1e94b1a03b0ba7e076a0cb548f3fd` |

The SHA512 also matches the captured registry SRI. Primary guarded extraction
and full published map bind 955 regular package files / 22,583,023 bytes to that
archive. This audit reuses that committed extraction proof, without extracting
or executing the archive. It rehashes all 955 files and exact membership in each
of the following four currently available package roots:

1. `/private/tmp/safe-bash-published-auth-JydnQ4/authenticated-package`
2. `/private/tmp/safe-bash-comparison-replay-20260827-EuLV2d/product/benchmarks/node_modules/just-bash`
3. `/private/tmp/safe-bash-published-auth-JydnQ4/execution-closure/benchmarks/node_modules/just-bash`
4. `/Users/kjopek/Workspace/safe-bash/benchmarks/node_modules/just-bash`

The reusable archive itself is
`/private/tmp/safe-bash-published-auth-JydnQ4/just-bash-3.4.2.tgz`.
In each package root the actual entry is `dist/bundle/index.js` and actual
manifest is `package.json`; neither was imported. Installed root 4 matching now
does not establish an immutable future candidate or complete live dependency
closure. Registry signature metadata, attestation URLs and source-build
provenance are not independently verified by this audit.

## Dependency closure: two distinct records

The old freeze still contains byte/membership-equal dependency trees:

| Root relative to old `product/` | Files | Recorded copied-tree SHA256, recomputed |
| --- | ---: | --- |
| `node_modules` | 318 | `034616cb714d6a1fd47b982208ddc8df95e61bb43cbb4ce0a7af50ad2be6e797` |
| `benchmarks/node_modules` | 3510 | `1bac5a42b755ba5909692232d04bb7ba46c9d37f4d1a6288c5a6fa0fff6e050c` |

Main lock SHA256 is
`9c04bb7d2c7d1894479f0c37ce367987c2130256e5bfbf426cfa1bd2729d740b`;
benchmark lock SHA256 is
`6aad93176a9f7fc2578dd720802ce93a1e71b3be9dd9052ef0a54fab8bdc7d70`.
Their actual old frozen files match. The primary graph accounts for 7 installed
main packages versus 33 lock entries including root, with 25 absent optional/
platform nodes; the benchmark graph has 81 installed packages and 82 lock
entries including root. Absent nodes are not authenticated installed passes.
Byte equality covers the retained hidden locks and manifests; it does not
individually authenticate other publishers' package archives.

Copied-tree digests retain the historical JSON representation with
`originalSymlink: null`. Actual dependency write bits were removed by the old
seal after its original modes were recorded. Both facts are explicit, rather
than silently normalizing an unexpected mode or link change.

**The 3,842-file base execution closure is no longer an exact-membership
match.** Every expected base file still matches, but two observers are present:

- `auth-observer/observe-load.mjs`, 1,523 bytes, SHA256
  `bb1d9e856b1a056f19deaad325568a3092354221ccc8731a25cea42eb94b9b9d`.
- `auth-observer/observe-process.mjs`, 1,017 bytes, SHA256
  `7986a7e8730b7c022e97f42d6d5bb497cc46455304af617541e5fe0d41c5b10c`.

The original `execution-closure.json` map digest remains
`110e7dd2dabc2419dccc6bd4ab0f0e6b1442ef12a58d81ac9cc747a028ae1f53`.
Its mismatch remains a blocked prerequisite **for that exact 3,842-only profile**.
The same primary commit also contains the later
`execution-post-run-check-attempt-1.json`, declaring those two additions.
All **3,844** entries and exact membership now match that separate record at
`/private/tmp/safe-bash-published-auth-JydnQ4/execution-closure`.
The later record is an exact reusable byte identity, not permission to run it or
to silently call the earlier closure unchanged.

The baseline-only attempt-002 manifest additionally supplies 11 exact worker/
WASM/data asset paths and 18 dependency entry paths. All 29 actual paths match;
none was loaded. The published just-bash subtree authenticates its included
assets, but not `sql.js`, QuickJS dependencies, native addons or other dependency
entries merely because their hashes match. Native libraries, module evaluation,
worker startup and optional provider/runtime usability remain separate proofs.

## Historical source and execution limits

Old source HEAD is `c2902a6016dd4a42818e27d055895c0dc29f73f2`, with source-manifest
digest `76deb591783ac168ca5daef04c4351d7e80b159c003cd27d3a445190ca6fd74c`.
It is a **dirty/untracked capture, not a committed-only snapshot**. Its 176
recorded source/config files still match in the retained old freeze. This does
not verify all current source/tests or authorize a new source freeze.
The committed old source/harness/goldens archive is 881,417 bytes, SHA256
`47b9a6d61ac3b26cf93c5e59c805406cc07395c5b08d8ded8945e820954d0f73`.

The old original profile used harness
`0294afb6e690433aed994868e5ed437ecf58ae48`; the aligned profile used
`d1b10a375a13f031f9f604a64395cd507f21a071`. Their actual 16 and 20 recorded helper
files and native golden files match. Golden SHA256 values remain respectively
`976601e3aeb465fcb5eb11e53e9e61e48978d148e8615a9ee37c2261743df801` and
`e305e1c3f3fa15e0f53699808c1cb20ea156c80b8ceff6d98835888ea5c57bb8`.
Do not combine their denominators: each is the same 224 original IDs under a
different scratch profile, not 448 unique cases.

The old reported scores, 222/224 versus 155/224 original and 223/224 versus
155/224 aligned, are **historical only**, not current scores or superiority.
Baseline-only historical cohorts, source captures and lifecycle findings remain
separate; their optional runtime assets do not create extra passing coverage.

Primary historical import evidence binds 442 package load-attempt events over
125 distinct package paths per old replay profile; entry attempts span 14 PIDs
per profile. The loader records before `nextLoad`: a load attempt is not module
evaluation. The old full replay lacks a complete ready/request/PID/recipe ledger.
Retain `CAPTURE-LIMITS.md` and `capture-qualification.json`; do not reconstruct
missing successful evaluation or all-child-normal-exit claims from scores.

The primary commit's later `execution-v3-receipt.json` records eight bounded
representative calls and ready-after-awaited-entry-import evidence. Its scoped
entry success is stronger than an isolated pre-load log, but does not prove all
module/worker/native-addon evaluation, asset reads, threads or syscalls. That
later execution does not repair the full replay's missing historical ledger,
increase its denominator, or authorize any execution here. No new module-load
trace was collected in this leaf.

## Native identities, profiles and unavailable inputs

137 of 138 historical native/data records match, covering 77 available distinct
paths out of 78 checked. These include 59 old224 records (bash/sh share a path),
the 59 baseline-only existing records, 15 baseline-only additional candidate
paths, system Bash, file/libmagic and the externalized tree binary/archive.
The missing path is the historically recorded coreutils-directory `strings`
candidate, reported as `ENOENT`; there is no install, alternate lookup or pass.

The historical baseline-only harness has 12 names without usable native identity:
`column`, `file`, `rev`, `tree`, `sqlite3`, `xan`, `yq`, `html-to-markdown`,
`js-exec`, `python`, `python3`, `time`. Separate file/tree profiles are now
byte-verified, but are not retroactively substituted into that old harness.
The other ten still require explicit legitimate identities/profile decisions.
No private runtime or ambient host command is searched for or implicitly used.

Profiles must remain distinct:

- GNU Bash 5.3, coreutils 9.7, sed 4.9 and individually pinned GNU utilities on
  **Darwin** are not a GNU/Linux oracle. BSD grep, find/xargs, Apple jq and other
  system utilities retain their own captured diagnostics and identities.
  `/bin/bash` 3.2 is a separate record, not a replacement for pinned GNU Bash 5.3.
- Preserve the user's GNU sed 4.9 global `^|$` substitution and invocation-wide
  successful quit under `-i`/`-s` policy; do not emulate BSD truncation or erase
  original BSD evidence. POSIX-unspecified environment ordering stays qualified.
- file 5.41 uses `/usr/bin/file`, executable SHA256
  `d1fee5edf3c39243cca0c4a0afc94816c55feb032ad5eaeb6d8170d8c7aa64ce`, and
  `/usr/share/file/magic.mgc`, SHA256
  `38fc8af9d342a3a1d32a626195314a913ee255d8cbd259067d665ea55735b7c0`.
  Preserve the original Darwin `-bi` oracle defect and separate corrected
  `--mime` profile. Hashing the database is not a new classification workload or
  proof of the complete dynamically linked libmagic execution environment.
- tree 2.2.1 uses `/tmp/safe-bash-tree-external-oracle-TbVJVK/tree`, SHA256
  `34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
  The adjacent `tree-2.2.1.tar.bz2` is present, SHA256
  `e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5`.
  The external-artifact record retains Darwin/compiler/manual/archive provenance.
  No rebuild, new publisher authentication, download or bit-identical rebuild
  guarantee is claimed. No private full corpus was searched or restored.
- Original TMPDIR-to-nonexistent-fixture-child and aligned precreated external
  scratch remain separate harness/golden profiles. Never add a fake product
  directory effect or silently use the aligned golden for original results.

### Actual version-only child envelope

Six sequential fixed absolute native executables ran with exactly `['--version']`:
GNU `true`, GNU Bash, GNU sed, BSD grep, file and tree. Each was hash-gated before
spawn and rehashed after close. The supervisor used no shell, ignored stdin,
owned process groups, an owned empty temporary cwd/HOME/TMPDIR, and only
`PATH=/usr/bin:/bin`, `LANG=C`, `LC_ALL=C`, `TZ=UTC` plus those owned directories.
No inherited credentials, startup variables or package runtime were supplied.

Caps: one concurrent child; six total; execution kill deadline **2,500 ms** and
total child deadline **3,000 ms**; **65,536 bytes combined stdout+stderr** per
child. Exceeding a cap is failure, not truncated success. The recorded results
are six spawned, six closed, six process groups absent, zero timeout/output
failures, zero cleanup signals and zero active managed children. Output sizes
are 302, 314, 636, 46, 48 and 106 bytes. Group absence is not a universal process
or thread census; OS scheduling/termination is not an absolute real-time promise.
No native oracle workload, comparison, engine or timing trial ran.

## Fail-closed release gate versus diagnostics

The machine release status is always
`BLOCKED_NO_AUTHORIZED_FUTURE_CANDIDATE` for this delivery. A completed hash audit
is not READY. The pure checker returns exit 2 with unavailable/unresolved inputs;
it also preserves the 3,842-only closure mismatch even though the explicitly
different 3,844-file profile matches. No blocker is silently waived.

For a future **release gate**, missing authorization, candidate identity, packed
artifact, accepted inventory/review, oracle/tool/cache, required runtime asset,
unknown profile or hash drift must stop before affected cases execute. Record
`BLOCKED_PREREQUISITE`; never install, recover, fallback, skip or count a pass
implicitly. Explicitly approved recovery would require a new recorded check.

For an explicitly authorized **diagnostic-only** run, unavailable rows may be
reported as `SKIP_NOT_RUN`, with case ID/profile, missing prerequisite and source
hash. They remain in the required denominator and in a separate not-run count;
they are neither passes nor evidence of parity. Keep strict failures, oracle
invalidity, engine/harness errors, timeouts and not-run rows separate. Account
for every approved ID exactly once per intended profile/engine. No synthetic
observations, denominator shrinkage, union inflation, stdout trimming, errno
diagnostic relaxation or builtin/plugin relabeling is allowed. No case list or
new denominator is authored by this leaf.

## Inputs required before a future freeze can be accepted

All remain **unprovided/unaccepted for a new candidate**, not inferred from live
HEAD, command-name count, old packed artifacts or historical approvals:

1. Root's explicit candidate/freeze authorization and integration-owner handoff;
   full root commit and Git tree IDs. Bind the index/status and either clean
   source proof or an explicitly accepted dirty patch plus complete untracked/
   required ignored-file byte manifest. Historical dirty source is not reusable
   evidence for that new candidate.
2. The exact selected source, tests, canonical TypeScript inputs, helper/config/
   consumer inventory and hashes. Native captured data must be explicitly
   classified, not blanket-excluded to make typecheck appear complete. Inventory
   existence does not establish that every canonical fixture was checked.
3. The actual packed `virtual-bash` archive, SHA256/size, package and export
   manifests, unpacked member/hash map, build provenance, Node/platform identities,
   locks and bounded dependency closure. No proposed public API or internal-module
   import substitutes for inspected packed public-consumer evidence.
4. The accepted exact **70-name** default/public registry inventory tied to that
   source and pack, registration/collision/replacement policy, and evidence that
   optional curl/SafeJS remain explicit and network is not auto-enabled.
   No 70-name list or current packed candidate is invented here.
5. Accepted current tracked-consumer inventory and a **different agent's packed
   review**, with exact report/manifest hashes, accepted verdicts, reviewer
   identity, actual pack hash, source identity and limits. Curie's pending work
   and an unrelated historical review are not those accepted artifacts.
6. Root-approved distinct GNU/BSD/libmagic/tree/scratch profiles, actual available
   native and runtime prerequisite identities, immutable input/golden hashes,
   and explicit baseline-only coverage accounting. Pinned just-bash 3.4.2 proof
   is reusable only at the verified paths/bytes and stated dependency boundary.
7. A separately approved execution envelope with exact case/engine/profile IDs,
   scored versus setup/warmup/control/transport calls, repetitions, child and
   concurrency ceilings, output/input limits, deadlines, network authorization,
   scratch rules, and lifecycle cleanup. Actual delegated request/settlement,
   successful-entry and child-close evidence must be retained; old missing
   ledger entries cannot be synthesized. Performance needs separate authorization
   and evidence and is outside this plan's executed scope.

## Rechecking this delivery

`check-hashes.mjs` uses Node builtins only: filesystem reads, JSON, cryptographic
hashes and stdout. It never imports a product, spawns a process, invokes Git,
extracts an archive, writes a file, installs or uses the network. Run it with the
already available Node and retain stdout as a new attempt, never overwrite an
accepted inventory. The output includes its own source and input hashes.

Hash-reader caps are **128 MiB/file**, **768 MiB total bytes**, **64 KiB/read**,
**10,000 entries/tree**, and **32 directory levels**; these are not native-output
caps. Final observed hashing read 488,156,494 bytes. An earlier 64 MiB/file cap
correctly blocked the 112,989,184-byte Node executable; that failed attempt is
retained and only the hash-reader cap was explicitly corrected. Node now matches
`5c899797c4eb8f1db5563eea56538342ddb3e9276ee1b04a5a1f0f1023d2b011`.

`native-versions.mjs` is a separate, non-pure supervisor; its recorded six calls
are complete. Do not rerun it just to recheck hashes or treat its opt-in flag as
future execution authorization. No whole-repository test/build/typecheck, oracle
recapture or comparison was run. Root review, not staging or committing, is next.
