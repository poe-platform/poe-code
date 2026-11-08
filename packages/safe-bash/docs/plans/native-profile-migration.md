# Native-profile migration infrastructure

Status: the explicit gzip source-bootstrap and seven-file staging extension is prepared for independent review. This extension changes only the existing source provisioner, its controls, and this document; the other three infrastructure files and eight reviewed rg files remain frozen. Workflow wiring waits for review. An authenticated input is not a qualified reference, and a qualified reference is not a passing comparison.

## Scope and ownership

The original infrastructure introduced:

- `tests/native-profile.ts` and `tests/native-profile.test.ts`.
- `scripts/provision-test-inputs.mjs` and `scripts/provision-test-inputs.test.mjs`.
- `tests/commands/search/native-tool-profile.json`.
- This document.

This source-bootstrap extension changes no production source, runtime dependencies, package scripts, workflows, existing test/helper callers, historical profile pins, frozen observations, discovery exclusions, or protected-role inventories. The controls use the workspace's existing development-only `memfs`. Explicit gzip mode uses only Node builtins; the backward-compatible xz mode requires an explicitly supplied existing authenticated xz executable. No global installation or native runtime dependency is introduced.

The maintained test helper is infrastructure for later reviewed caller changes. It does not currently cause any historical comparison to skip or become unavailable. Frozen old-Mac evidence, including Bash 5.3.0, remains unchanged. Fresh Linux-qualified Bash 5.3.15 and its parity matrix remain separate required work.

## Qualification contract

`NativeProfile` contains an ID, an evidence locator, and documented host fields: required `platform`, optional `arch`, and optional kernel `release`. Do not supply an architecture or kernel restriction that the specific historical evidence does not document. Node/libuv, caller identity, permissions, locale, binary path, version, and hash are admission prerequisites, not additional reasons to declare a matching host unavailable.

| API/result | Meaning |
| --- | --- |
| `currentNativeHost()` | Samples platform, architecture, and kernel release when called. |
| `matchNativeProfile()` → `MATCHING` | Only the declared host dimensions match. No executable admission or comparison has happened. |
| Either qualification API → `UNAVAILABLE` | A documented host dimension mismatches. The record includes expected/actual fields, mismatched dimensions, profile ID, evidence, and a reason. This is never a pass. |
| `qualifyNativeProfile()` → `ADMITTED` | The caller's strict admission callback returned an identity. This is not a comparison result or a native pass. |
| Admission callback throws | The original error propagates. Missing tools, wrong hashes/versions, caller/locale prerequisites, and launch failures must fail on a matching host. |

Profiles/host records are validated before host selection. Malformed configuration is an error even on a nonmatching host. On a valid nonmatching profile, the admission callback is not invoked, avoiding incompatible executable reads/launches. Module import performs no tool discovery, executable admission, or automatic skipping.

Validation captures own data-property descriptors into owned records. Accessors are rejected without invoking their getters; accepted nonenumerable properties retain every supplied constraint in the explicit, frozen output snapshots. Profile ID, evidence, expected/actual dimensions, mismatch list, and reason use validated snapshots, not late caller reads. After asynchronous admission, `ADMITTED.profileId` comes from the validated matching result, even if the caller mutates its profile or replaces a field with a getter. Falsey thrown values propagate unchanged. The opaque admission `identity` is still the strict callback's object, not a deep-cloned or independently validated tool identity. Proxy descriptor reflection can run caller code; this is not a hostile-Proxy sandbox or an atomic snapshot of a concurrently mutating external object graph.

The helper deliberately does not implement a binary verifier or call `test.skip`. The callback remains responsible for the existing strict identity/prerequisite checks; returning an arbitrary object cannot establish genuine reference qualification. A later caller must independently record the comparison result.

Before rollout, each case needs an explicit mapping:

1. Preserve its original identity, fixtures, and declaration; keep native declarations even when the reference is unavailable.
2. Keep portable candidate/contract assertions and frozen-data integrity checks active.
3. Separate native-dependent observations from portable assertions in mixed tests. Do not skip a parent before declaring its children.
4. Remove eager binary admission from module initialization and file-wide hooks that otherwise block portable checks.
5. Preserve strict negative admission controls on every host; a bad explicit binding must not turn into an unavailable success sentinel.
6. Report unavailable native comparisons separately from passing portable parents. Count declaration sites, expanded test cases, fixture rows, and assertion sites as different units.

No `if (CI) skip`, blanket oracle skip, test-file exclusion, expectation rewriting, or case removal is permitted. All 87 generic rg availability cases remain required on Linux; they are not historical Mac-profile cases. The 71 table and 216 shared-stdin fixed candidate rows likewise remain active independently of live native replay.

## Authenticated test-input bootstrap

Prepare an owned, canonical, private 0700 parent outside the package tree. Explicit built-in gzip mode, including the optional exact metadata fixture staging, is:

```sh
node scripts/provision-test-inputs.mjs \
  --parent "$OWNED_PRIVATE_PARENT" \
  --source-mode gzip \
  --stage-metadata
```

Omit `--stage-metadata` to leave all outputs in the new external private directory. Gzip mode rejects every xz argument; it never searches for xz or falls back to it. The legacy CLI remains supported after independently admitting its existing decompressor binding:

```sh
node scripts/provision-test-inputs.mjs \
  --parent "$OWNED_PRIVATE_PARENT" \
  --source-mode xz \
  --xz "$ADMITTED_XZ_REALPATH" \
  --xz-size "$ADMITTED_XZ_BYTES" \
  --xz-sha256 "$ADMITTED_XZ_SHA256"
```

Omitting `--source-mode` preserves the legacy xz contract and still requires all three xz arguments; omission does not auto-detect a mode. These are explicit operator-provided paths/identities, not assumed developer locations. The parent must already exist as an owned canonical private directory outside the package source tree, with trustworthy ancestors and no permissive ACL granting other principals access. The bootstrap creates a new unique `safe-bash-inputs-*` child; it does not reuse an existing output tree, install globally, overwrite existing `.oracle` fixtures, or export PATH.

The default output is the authenticated GNU coreutils 9.7 source archive plus exactly six source/manual members. It does not compile or copy any coreutils executable. A separate `provision-result.json` is an audit manifest, not an eighth source fixture.

| Input/output | Bytes | SHA-256 |
| --- | ---: | --- |
| `coreutils-9.7.tar.xz` | 6158960 | `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf` |
| `coreutils-9.7/src/chmod.c` | 18743 | `9344f0799f8c50a10984d5cd708a6be41169b77bfd703f2640238618ccc51393` |
| `coreutils-9.7/src/stat.c` | 57957 | `32c77c3620837a73dc0ed72dc7ee874f8e52946c8c8c2c4b2255e4f41bea6bad` |
| `coreutils-9.7/src/mktemp.c` | 10194 | `176f2db23caa6cde6086d669d905d2c6ab0ba229e88f73aa853db76f2fa14113` |
| `coreutils-9.7/lib/modechange.c` | 13085 | `13bfe2cf140bc85b2630c3a2a6d1a9f6ae3e53f58c82e6976abd9a51aac723db` |
| `coreutils-9.7/src/comm.c` | 14595 | `3517b5f9e88bbb67ce93e3075811d0856647104ca83c40001f7fa2dcf07c7336` |
| `coreutils-9.7/doc/coreutils.texi` | 667701 | `39b126752866fff675e462bd44d76f3e034abafe462a069cebd53ef39fc53eca` |

The archive URL is `https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.xz`. These are existing historical archive/member identities, not new replacement pins. The provenance establishes the recorded publisher HTTPS source and matching digest; it does not claim detached-signature verification of this archive.

### Explicit gzip source mode

The additional source input is `https://ftp.gnu.org/gnu/coreutils/coreutils-9.7.tar.gz`, exactly **15107617 bytes**, SHA-256 `0898a90191c828e337d5e4e4feb71f8ebb75aacac32c434daf5424cda16acb42`. The official GNU announcement, `https://lists.gnu.org/archive/html/coreutils/2025-04/msg00025.html`, publishes both archive digests. The prior bounded audit matched both downloaded archives against those published digests, then verified all six gzip members against the unchanged table above. Detached OpenPGP verification is not claimed.

Gzip mode downloads and authenticates the original xz archive as opaque retained data, then separately authenticates gzip before built-in `gunzipSync` and the maintained tar parser. It does not decompress xz, recompress an archive, retain a second source archive in the output tree, compile GNU tools, or change any existing member pin. The gzip tar payload observed in the authenticated audit is 63078400 bytes; equality of the complete gzip/xz tar payloads is not claimed. Both modes produce the same seven pinned source/archive outputs plus the external audit receipt.

The API `provisionInputs({ parent, inputs, sourceMode, xz?, gzipSource? }, dependencies?)` preserves omitted-mode legacy behavior. Explicit modes are only `xz` and `gzip`; explicit null/unknown modes fail. In gzip mode the first retained input must be xz and the separate gzip source must have exactly equal prefix/member identities; an xz binding is forbidden. `gzipSource` defaults to exported `COREUTILS_GZIP_INPUT`. It is a trusted low-level control seam, not a CLI pin override. Inputs and mode are captured before asynchronous work. Receipts keep `INPUTS_VERIFIED_NOT_QUALIFIED`, record `sourceMode` and both download identities, and report `extractor: null` for gzip.

### Exact metadata staging

`stageMetadataInputs({ sourceRoot, packageRoot }, dependencies?)` reauthenticates the seven known files from a canonical external private root. It does not accept an untrusted receipt as authority or copy an entire tree. The CLI's boolean `--stage-metadata` uses the provisioner's own package root, and permits no arbitrary destination argument. It stages only the table's seven paths under `tests/commands/metadata-stress/.oracle/` in that package. No gzip archive, receipt, rg executable, unrelated source file, or generated binary is staged there.

The `.oracle` destination must be absent; an existing empty directory also fails. Its existing canonical parent must be job-owned with trustworthy ancestors. The new `.oracle` and selected subdirectories are private 0700. Every source file is bounded, regular, canonical, singly linked, owner-matching, mode 0644, and size/hash authenticated before destination creation. Source subdirectories are canonical private 0700. The declared path list is fixed independently of the test-only `coreutilsInput` dependency. Paths and identities are owned snapshots, not late caller reads.

Staging uses exclusive/no-follow file creation, writes only verified buffers, sets 0644, rechecks source/destination anchors and verifies output bytes. On partial failure it unlinks only recorded file identities and removes only recorded empty directories, never recursively deleting a destination tree. Replacements, foreign collision files, unsafe permissions, or nonempty cleanup fail closed with an aggregate error; the foreign content is preserved and partial owned paths may require inspection. Provisioned external inputs remain available if the later staging phase fails. The stdout result adds `staging` with status `METADATA_INPUTS_STAGED_NOT_QUALIFIED`; no additional file is written inside `.oracle`.

`parseProvisionArguments(args)` exposes the pure CLI contract. `main(args)` provisions, then optionally stages. The legacy xz options and `--include-linux-rg` remain supported. The dependency seams are trusted test code, not plugin or untrusted-pin admission APIs.

On an actual Linux x64 host, the additional `--include-linux-rg` option also stages the authenticated proposed rg archive and `bin/rg` in the new job directory. It never executes rg. The option validates the packaged proposed profile's exact size/hash before JSON parsing and rejects other hosts. Its result remains `INPUTS_VERIFIED_NOT_QUALIFIED`; do not automatically activate the staged executable in test PATH.

Source staging now has the narrow explicit contract above, but workflow activation remains deferred. The separately reviewed rg callers/provisioner are unchanged by this extension. Neither source bootstrap nor staging supplies the missing GNU executables or establishes Linux qualification; fresh Linux CI is not claimed green.

## Security scope and limits

### Enforced bounds and admission

- Downloads use HTTPS with an allowlist of `ftp.gnu.org`, `github.com`, and `release-assets.githubusercontent.com`, manual redirects with at most three follows, no supplied authorization headers, and a 30-second abort deadline. Credential-bearing URLs, nondefault ports, fragments, encoded responses, unexpected status, and size/hash mismatches fail. Exact size/hash authentication precedes decompression and archive parsing. Each body is additionally limited to 16384 chunks, including empty chunks.
- Each compressed input is capped at 16 MiB, each inflated archive at 128 MiB, each selected member at 8 MiB, and archive entry count at 8192. At most two retained archive declarations and six selected members per archive are accepted; gzip source mode adds exactly one non-retained gzip source download for the first archive. The CLI selects only fixed coreutils inputs and, optionally, the fixed proposed Linux rg input.
- Parsing accepts the authenticated sources' V7 and supported ustar/GNU-header regular-file/directory layouts. Links, special files, PAX/long-name extensions, duplicate paths, traversal, absolute paths, malformed headers, truncation, missing required members, trailing nonzero data, and member identity mismatches fail. Only selected regular members are emitted; archive permissions/owners are not applied.
- Output creation uses exclusive/no-follow file flags in new private directories, with owner/mode, realpath, device/inode, size/hash, and post-write checks. A collision is an error, not an overwrite. Ancestor permissions/ownership are checked; root-owned sticky ancestors are allowed. Parent/directory identities are checked again during work.
- Failure removes only the still-admitted owned child. If identity changes prevent safe cleanup, cleanup is refused and the error reports the remaining owned-root path. There is no fallback deletion through a replaced parent.
- Gzip uses bounded Node decompression. XZ uses only the explicitly supplied canonical existing executable after bounded regular-file size/hash admission and executable/non-group-writable mode checks. The compressed bytes sent to its stdin are the same authenticated bytes, not a reopened unverified archive path.

Exact xz invocation:

```text
<admitted-xz> --decompress --stdout --memlimit-decompress=128MiB
```

Its working directory is the new private output root. Its environment is exactly `PATH=/usr/bin:/bin`, `LC_ALL=C`, `TZ=UTC`, and `HOME`/`TMPDIR` equal to that root. No ambient `XZ_OPT`, loader variables, or credentials are forwarded. Stdout is capped at the inflated bound, stderr at 64 KiB, and execution at 30 seconds; failure/overflow kills the child and waits for its close before settling. Nonzero exit, signal termination, or any stderr is an error.

### Not a universal sandbox

This is a trusted-job bootstrap on a local POSIX filesystem, not protection from hostile same-UID code, privileged users, arbitrary filesystem implementations, permissive ACLs, or another principal able to mutate the tool store/ancestor namespace. Portable Node path checks do not provide descriptor-relative traversal or atomic descriptor execution. Checks detect the covered substitution cases but do not eliminate every check/use race against such excluded actors. The job must provide exclusive ownership and trusted ancestors/tool storage.

The xz hash binds the supplied executable bytes; it does not authenticate the operator's chosen pin against a distribution authority or freeze all loaded libraries. The existing decompressor runs with the job user's ordinary privileges, without an OS sandbox or network confinement. No universal decompressor-sandbox claim is made.

Buffer limits are not total process RSS limits. Compressed collection/concatenation can temporarily retain two copies, as can streamed xz output collection/concatenation; selected members are copied, and verification adds bounded buffers. XZ's internal 128 MiB decompression-memory limit is additional to Node memory. Provision inputs sequentially and budget process memory beyond the 128 MiB inflated-output cap.

Built-in gzip removes the external decompressor binding from that mode, not all resource risks: its 128 MiB output cap is not a total RSS bound or a hard synchronous CPU-time deadline. Exact seven-file staging retains at most the sum of the seven pinned input sizes in verified buffers, plus readback buffers. Isolation assumes no hostile same-user concurrent writer and no permissive ACLs; checks are not a universal kernel-race sandbox.

Injected filesystem/fetch/inflate/spawn and staging coreutils-input dependencies are trusted control-test hooks, not an untrusted plugin boundary. The controls use in-memory filesystems; their pass does not establish every real-kernel race behavior.

## Proposed Linux rg identity, not execution qualification

`tests/commands/search/native-tool-profile.json` records official ripgrep 15.2.0 for `x86_64-unknown-linux-musl`:

| Artifact | Identity |
| --- | --- |
| Archive | `ripgrep-15.2.0-x86_64-unknown-linux-musl.tar.gz`, 2265718 bytes, SHA-256 `33e15bcf1624b25cdd2a55813a47a2f95dbe126268203e76aa6a585d1e7b149c` |
| Official checksum file | 114 bytes, SHA-256 `650080eb90718156132c821d150d8b74818f66de47969e38eef5a2dce3e2a5e6` |
| Executable member | 5408904 bytes, SHA-256 `e62198eb19b136b88c330af83647b5a962cb99b6b1f066758568f12de1974849` |
| Annotated tag | `6ec72defacfb042f203ca0b4bf2513a0a5505a7e` |
| Source commit | `e89fff89ac9af12e8d4ce9d5fd07beb408ca730f` |

Primary provenance locators are the official release `https://github.com/BurntSushi/ripgrep/releases/tag/15.2.0` and its release/tag API records, with exact artifact/checksum URLs in the profile. The official release asset digest, downloaded checksum, and downloaded archive agree. GitHub's annotated-tag API reports a valid verified signature; this is not independent local signature verification or proof that the binary reproducibly builds from that commit.

The official archive was downloaded under bounds and authenticated. Its member was hashed opaquely in memory and validated through the new archive parser. No downloaded executable ran or was written into the package. A synthetic Linux host object used to validate metadata in the Mac-side parser audit is not a Linux execution result.

The profile remains `PENDING_LINUX_EXECUTION`, with `executed: false` and no observed version. Before activation, record the actual Linux OS/architecture/kernel/Node, reverify artifact/executable identities, run an admitted clean-environment version probe, and run all 87 generic rg cases plus affected search-stress comparisons. Other Linux architectures require separate authenticated bindings. Do not substitute Ubuntu 14.1, the developer's Mac rg, or a Codex installation. Old-Mac profiles remain untouched.

## Validation commands and honest accounting

From the package directory:

```sh
node --import tsx --test tests/native-profile.test.ts
node --test scripts/provision-test-inputs.test.mjs
node --check scripts/provision-test-inputs.mjs
node --check scripts/provision-test-inputs.test.mjs
node ../../node_modules/typescript/bin/tsc --noEmit --strict \
  --noUncheckedIndexedAccess --exactOptionalPropertyTypes --skipLibCheck \
  --target ES2022 --module NodeNext --moduleResolution NodeNext --types node \
  tests/native-profile.ts tests/native-profile.test.ts
```

Observed focused results after review fixes: 36 helper cases pass (12 top-level plus 24 nested), and the unchanged 40 bootstrap cases pass (20 top-level plus 20 nested), with no failures, cancellations, skips, or TODOs. The helper typecheck passes; the earlier bootstrap syntax checks remain recorded. Zeno's earlier independent review passed the original 17 helper plus 40 bootstrap controls but found the late ID read and dropped nonenumerable constraints. The expanded helper controls first recorded RED: 36 total, 31 pass, 5 fail (including the failed parent); after the snapshot fix, all 36 pass. These 19 additional cases preserve the original cases and cover async mutation, getter rejection, nonenumerable constraints, descriptor-only proxy reads, and falsey admission rejections. Re-review of the fix is pending. No actual network or native utility subprocess ran during these regression checks. Authentic source bootstrap previously run on Darwin 25.4.0 arm64/Node 22.22.2 verified the seven pinned data outputs; this is not Linux reference qualification or historical native-suite validation.

At the recorded discovery measurement on August 29, 2026, `23:58:54Z`, discovery was **652 TypeScript test files**, versus the original 651. Only `tests/native-profile.test.ts` was added; no existing file/case was removed to preserve a stale count. This does not supply a newly measured full-suite runtime-case total.

The original 40 bootstrap controls and the earlier 652-file discovery measurement above are historical evidence, not current totals. The gzip/staging extension retains all original controls and currently passes **85 bootstrap cases: 36 top-level plus 49 nested**, with zero skips/cancellations. Its initial RED recorded 83 cases, 51 pass/32 fail; the subsequent explicit-null-mode and stream-budget RED recorded 85 cases, 82 pass/3 fail, including the failed parent. The final focused run passes all 85. An additional audit replay of the already authenticated real gzip/xz archives verified provisioning and all seven staged outputs in memfs, with no new network or native subprocess and no actual fixture writes. This is source-data verification, not GNU executable qualification.

### Maintained validation route — Singer-owned

The currently observed `packages/safe-bash/package.json` already contains the explicit maintained route:

```json
{
  "test:runner": "node --test scripts/integration-inputs.test.mjs scripts/provision-test-inputs.test.mjs"
}
```

`test:unit` invokes `npm run test:runner && node scripts/test.mjs`, so the existing explicit route includes this expanded control file without a new wildcard or configuration edit. This worker did not change or run Singer's combined runner controls; that route's latest execution evidence belongs to Singer/root. `npm test` retains its existing direct TS-only behavior; do not claim every alias runs the bootstrap controls. This extension adds no TS test file and must not be counted as a discovery increase; the separate rg handoff measured 654 TS files.

No protected-role/fixture-exclusion metadata update was required to admit the new root-level helper test in the measured discovery. Do not add these maintained files to captured-data exclusions. Any additional explicit protected-role metadata requirement belongs to Singer's review, not an unapproved inventory edit here.

## Review and deferred work

The durable implementation handoff contains exact six-file hashes, commands, retained RED/GREEN logs, publisher provenance, installed-xz identity/scope, and real-source smoke results. Freeze means these bytes are offered for independent review; it is not a Git commit, permission change, or native-parity claim.

Singer owns the delegated metadata/expr/stream-format case partition. Other historical-group roster work is deferred. Pre-partition declaration/row inventories remain audit evidence, not approved native/portable classifications or a Linux-unavailable denominator. Do not activate callers based on name matching or a broad file classification.

Outstanding work includes independent review of this source extension, workflow wiring, actual Linux rg execution qualification, remaining per-case native/portable decisions, generic GNU/BSD tar and sed/awk/host-Bash qualifications, and GNU coreutils 9.7 executable provisioning. The prior 660 prerequisite failures, other 15 native/opt-in skip records, three optional fallback-path limits, and original runtime artifacts remain evidence, not passes. No full build, historical suite, Linux parity matrix, or workflow activation is claimed by this infrastructure change.
