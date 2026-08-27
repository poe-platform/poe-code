# Independent pre-replay audit: frozen DU + Overlay v6

Date: 2026-08-27

Verifier role: new independent leaf; no delegation and no fixture authorship

Candidate: `9a5a6f922beb1bc6ba84a0cd32ea7a12f8ce985d`

Freeze: `cea13e21b26e3bf85c60e56e7a846e28b6f68720`

Freeze tree: `b61988ff4a23a6a90d5ffa15149b314af0ae6c63`

## Pre-execution decision

The exact committed v6 inputs and replay protocol are sound for the requested
bounded semantic replay. No candidate or native semantic case was executed
before this checkpoint. The frozen inputs are not edited or reconstructed.

One non-material origin-metadata defect was found and is preserved: the
`ORIGINS.json` record for `config/candidate-selected-paths.txt` spells its
SHA-256 as the 63-hex string ending `...679`, omitting the final `b`. The v6
manifest, the v5 and v6 Git blobs, and independent hashes of both committed
files all bind the same correct value
`9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b`.
The record's Git blob `65e8eea7ed343140252629a5e030c102033e48d2` is also correct.
This redundant typo does not change admitted inputs, assertions, execution, or
the independently proved v5-to-v6 byte identity, so it does not make replay
unsafe or untrustworthy. It is not silently corrected in the freeze.

## Complete frozen inventory

`MANIFEST.json` is 4,748 bytes, SHA-256
`417a776d878fe8bf8ee363327dd603b3b34d64df09f1b3314b2da33b84df4ef7`,
Git blob `0fb0850e8a9db3962523d32b1ad088b9847670a6`, mode `100644`.
Its 19 non-self records are unique, ASCII-bytewise ordered, and together with
the manifest exactly equal the 20-file committed subtree. Every entry is a
regular `100644` blob; no symlink, special entry, extra file, or `AGENTS.md`
exists in it.

| Path | Mode | Bytes | SHA-256 | Git blob |
| --- | --- | ---: | --- | --- |
| `CASE_MAP.md` | 100644 | 1,617 | `9c29bae3b8cd364e51f7a6842983d44bdd338437354bb23605068c835f37b794` | `37676beffba4e75715c494c2e8b3d9348f096668` |
| `FREEZE.md` | 100644 | 6,859 | `6308a5d530fbf21ae4d290618a76fcf2a5c01b9517064c648ff0151fd60a5c82` | `10c218f19a26372c62207b9210ec6ddb1e1255ab` |
| `MANIFEST.json` | 100644 | 4,748 | `417a776d878fe8bf8ee363327dd603b3b34d64df09f1b3314b2da33b84df4ef7` | `0fb0850e8a9db3962523d32b1ad088b9847670a6` |
| `ORIGINS.json` | 100644 | 5,098 | `032b5c4cf268dd05aa58de35174a598080639a597e2e5baa1fbb33b1a710bb7e` | `2b04b362da8314bf42e44bcc6ffdeadf01002c75` |
| `config/candidate-selected-paths.txt` | 100644 | 7,522 | `9427aad46a7f184d94517a666ab02a8f1da43ccf9074c5a15186d4569233679b` | `65e8eea7ed343140252629a5e030c102033e48d2` |
| `config/oracle-identity.json` | 100644 | 582 | `7bc8e13ea19e432b8320d08f5e19f8e4cbcbe4f8dad19984df6f9259960ebf4f` | `006e80030216385b81ae0917ab4822ccfd8d18b7` |
| `config/static-tooling.json` | 100644 | 210 | `a665c0d24aedea5a987d444e98d9708378a1db44c49b5a10872cf2a11062506f` | `09bca6e67f082086ea7b7020acf08f0ed3eea673` |
| `consumer/consumer.ts` | 100644 | 603 | `14e55e16f60f8262c2b299fcf48911d2789e3ec1c7b44674dd622f5dab4552b7` | `6544c8e7f1fb4df43d84ea6c8e1b812fa040ca9d` |
| `consumer/package.json` | 100644 | 93 | `52fe278e686f24c3992cd55042b2a5029bc3de967ab198821020c423fe85344f` | `58b3477b86fba4b5cf05ed7ac6715996ea6e9fce` |
| `consumer/runtime.mjs` | 100644 | 1,420 | `61e13d86b50487bb6a768859e75d111d896c3502b9ce1b286637b43da2ad87b5` | `5d4b023c175da6084b5cf05ed7ac6715996ea6e9fce` |
| `consumer/tsconfig.json` | 100644 | 236 | `1ece8865863403be31eb2601b88f1739c5412dfe495e7dba65b66e43a2fc607b` | `9be38da0ab7fecf777ed8667dce8015956f9af16` |
| `fixtures/native-env-cases.json` | 100644 | 4,259 | `ba95af81e2ffd7f7b80afb4a49a173487d9dacb7c911c61b31bf80b515c8cd5b` | `5d10b771614815024262bce0ccd7f4bda843cadd` |
| `harness/attest-loader.mjs` | 100644 | 1,358 | `856d860f818db6848388be87da7cd59ee4def1bf133abe582206bbd69b083d1d` | `f3ecf208359702d9946f13b5da8558fa0792bea2` |
| `harness/process-manager.mjs` | 100644 | 10,866 | `f322101cfaa23612287cd728f52f50c672a19325eda00b69d8280827d83cfa5d` | `28e7ac96913d169bb1f2bee3c2c63736ade16c63` |
| `harness/process-timeout-control.mjs` | 100644 | 565 | `2ac32a6d8a09f7f37f157e2adc1ac6b1fbd7cc0899cc7d643542a7dc743dc652` | `b1d7d317bc8d48b1b07a20d79d2308cea603d28d` |
| `harness/verify-original.mjs` | 100644 | 26,190 | `c08b96e73891995f329583b7d04d7837e1cd66953e13790b906d833f5fcc1c5a` | `14a93028c2c9dcb4ba9fee4a44d8acb18055dd6c` |
| `harness/verify-v5.mjs` | 100644 | 50,453 | `f40777ca6cf3e8cbc0ca86b1750ce80162e9bb5e565da77bdabdd778645185ce` | `5ebbf27cbcf94ebec1e0ec93592d94fde3e9d262` |
| `native-env.mjs` | 100644 | 6,204 | `e537055e0b7516e2a2ddcd520f5197625334d2493b1b238d82b99edc94fd7def` | `894f6b7aae57e800d8e5eb603a9ea33cb665a38f` |
| `replay.mjs` | 100644 | 43,382 | `8ebffca4e09583065699aabf6ade4918adfc1e8cdd23c858d90109b2b2ea2b1f` | `055fb0d782c3408c2d1382a2fe035c97a88d2641` |
| `verify-freeze.mjs` | 100644 | 2,463 | `6644f474bcf2077cf1f8b35602bb0e53c23623b281cfeec357dad6578c1166da` | `8650210d1dd27f342cc3903db75b4ee31352c690` |

The frozen verifier itself returned file count 20, the exact tree above, the
manifest SHA above, all non-self bytes verified, and zero forbidden AGENTS.

## Origin, candidate, and oracle audit

The v5 base resolves to commit
`ea02d6b79beeac36d263743c77e15bda7931dc67` and tree
`c35c1a0ff3ae1f93ebdf3e166739cff6b56cffd3`. Independent byte comparison
confirms all 11 `byteIdenticalFromV5` files really are identical, including
`harness/verify-original.mjs`, intentionally named `harness/verify-v5.mjs`,
the 16-row fixture, all consumer files, and loader. All six `modifiedFromV5`
records bind the declared old Git blob and SHA-256 and differ in v6. Both new
process-control files are absent from v5. The sole discrepancy is the redundant
63-hex origin string disclosed above.

The selected candidate inventory has exactly 249 unique, sorted paths. All 249
resolve in the exact candidate in the same order, and none is `AGENTS.md`.
This is the scoped product/build/test inventory, not a claim that the repository
commit contains only 249 files. The inspected candidate package has no runtime,
optional, peer, or bundled dependencies. Its package name remains
`virtual-bash`; DU is intentionally not a root export, exported subpath, or
default aggregate command.

The requested oracle resolves exactly to
`/Users/kjopek/Workspace/safe-bash/tests/commands/metadata-stress/.oracle/coreutils-9.7/src/du`,
SHA-256 `f1df033deed07d208d80128568404c1043b283c59f294164f1240789bfadcf2b`,
with first version line `du (GNU coreutils) 9.7`. The bounded identity probe
exited 0; its root PID and owned process group are gone.

## Assertion and policy audit

The original suite is the exact prior 24-case blob. The fresh suite is the
exact v5 verifier blob and emits 40 non-overlapping records: 31
`historical-frozen-derived`, two `postfreeze-lifecycle-addition`, and seven
`v5-observer-policy-control`. Source and moved-package suites are reported
separately and are not added together.

The measured DU/metadata window is correctly isolated from snapshot observers:
full backing enumeration/content capture completes before pre-action lstat-only
measurements, action calls are reset, post-action lstat-only measurements occur
before after-snapshots, and the assertions retain full before/after stat objects
and every field delta. The policy admits only an `atimeMs` delta on the same
layer/path for which the measured action recorded `readdir`. It rejects file
atime changes, unlisted-directory atime changes, and every non-atime field
change. It separately requires unchanged entry sets and bytes, zero explicit
mutation calls, zero content reads, and therefore zero copy-up. Direct
stat/lstat, real lstat, and observer-only controls remain explicit. Real
directory listing, observer-only file read, file-atime, mode, byte, entry,
pending-removal, content-read, and copy-up controls exercise the boundaries.
This is the approved directory-atime read-effect contract, not full-stat purity.

The 1,500-byte `0x61` payload independently hashes to
`b935f6b7a9c56a15e7b99c8d6d4b5e918f5a68fafc4490544a446b2ae47bf809`.
All 16 literal rows are unique and frozen as follows:

| Selected key / case | Required result |
| --- | --- |
| no key / `no-env-default` | success, 2 units |
| `DU_BLOCK_SIZE` valid | success, 1 unit; wins over both lower keys |
| `DU_BLOCK_SIZE` invalid | success, default 2 units; no lower lookup |
| `DU_BLOCK_SIZE` empty | success, default 2 units; no lower lookup |
| `DU_BLOCK_SIZE` plus valid explicit `-B3072` | success, 1 unit |
| `DU_BLOCK_SIZE` plus invalid explicit `-B` | failure, empty stdout, invalid-block diagnostic, zero filesystem calls |
| `BLOCK_SIZE` valid | success, 1 unit; wins over `BLOCKSIZE` |
| `BLOCK_SIZE` invalid | success, default 2 units; no lower lookup |
| `BLOCK_SIZE` empty | success, default 2 units; no lower lookup |
| `BLOCK_SIZE` plus valid explicit `-B3072` | success, 1 unit |
| `BLOCK_SIZE` plus invalid explicit `-B` | failure, empty stdout, invalid-block diagnostic, zero filesystem calls |
| `BLOCKSIZE` valid | success, 1 unit |
| `BLOCKSIZE` invalid | success, default 2 units |
| `BLOCKSIZE` empty | success, default 2 units |
| `BLOCKSIZE` plus valid explicit `-B3072` | success, 1 unit |
| `BLOCKSIZE` plus invalid explicit `-B` | failure, empty stdout, invalid-block diagnostic, zero filesystem calls |

The product fixture tests these exact literal outcomes as one suite record. The
native runner executes all 16 rows independently with sanitized environment and
records the literal argv/environment, actual per-row cwd, payload identity,
raw stdout/stderr/status, PID/group, and closure. Native interpretation remains
only GNU-9.7 single-file apparent-size environment precedence. The three known
ordering differences and O060 are not reclassified or implemented.

## Audit of the four v6 protocol corrections

1. Before actual archive creation, the runner inventories all pack inputs,
   rejects forbidden `AGENTS.md`, runs `npm pack --dry-run --ignore-scripts
   --json`, proves the dry run created no `.tgz`, and admits only safe paths
   whose sizes match inventoried source files. It then requires the actual npm
   record and pre-extraction tar inventory to equal that admitted plan and the
   extracted bytes to equal admitted source bytes. The invalid-packlist control
   is in-memory and increments no archive/write/extraction counter.
2. Candidate dependency fields are required empty. The consumer manifest has no
   dependencies. Install is offline, scriptless, lockfile-disabled, omits dev,
   points registry access at a closed loopback endpoint, and admits/pins only the
   already hashed local package archive before install. The installed complete
   inventory must equal the extracted package inventory.
3. Every build, npm, tar, suite, native, type, version, Git, and control spawn is
   owned by a detached POSIX process group with a finite timeout. Raw partial
   stdout/stderr/status is retained. Timeout and signal shutdown send TERM then
   KILL as needed and probe root PID/group closure. The real timeout control
   reports a grandchild PID, forces escalation, and requires the root, group,
   and grandchild gone. Each native row supplies and records its actual cwd.
4. The materialized freeze is checked against exact inventory, byte size,
   SHA-256, and Git blob before cases, in `finally` before cleanup on success or
   failure, after successful cleanup, and again by the bootstrap parent after
   the child. New and deleted entries fail. Mutant copies are separately
   admitted and each is removed with an ENOENT probe; whole scratch and bootstrap
   scratch receive the same successful-cleanup probe. Evidence is outside the
   frozen tree.

The runner also authenticates the full freeze and candidate commit resolutions,
the complete 249-path selected archive before extraction, source inputs before
pack and after all cases (including append checks outside generated `dist`),
foreign index fingerprint, physical moved module loads and nextLoad bytes,
complete package/build/tar/install inventories, strict NodeNext with
`skipLibCheck:false`, runtime boundary, wrong-root/source-fallback, missing DU,
restored cleanup behavior, declaration, packlist, and process-timeout controls.
No material protocol or assertion defect blocks replay.

## Preserved limits and history

The prior 867,078-byte stdout remains SHA-256
`3fa5f7e7cc3a1bb9133086b06c41ac4f671e562a62192d144e9c800dd9df5e14`
and retains 10 passes/22 failures. Its stderr and status hashes remain
`5fa997f91509e743cd70fb5fd20f5a6dffd35bc5e074e0cf8038ec235a4571fe`
and `93d7432ac47672a3e8d78119710975fa84c477a7db057947787cc24874586082`.
The unavailable pre-correction blob and exact v2-to-v3 delta remain permanently
unproved. The earlier 15 forbidden temporary `AGENTS.md` copies remain a
historical incident; the unsafe migration audit is not invoked. No current
repository `AGENTS.md` was changed or copied.

Replay may establish only the exact frozen scoped result. It cannot establish
O060, the three native ordering cases, public/default DU, native parity,
GNU/Linux behavior, deployed-provider behavior, a whole gate, superiority, or
project completion.

The semantic runner result directory reserved after this commit is
`approved-v6-replay-9a5a6f92/replay-001`; it does not exist at this checkpoint,
as required by the self-materializing CLI.
