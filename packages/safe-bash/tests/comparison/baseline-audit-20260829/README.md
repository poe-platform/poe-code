# Primary-source baseline audit — August 29, 2026

## Current binding

**SOURCE/METADATA only; no admission, benchmark or engine execution.** Official npm latest and the most recently published version are both **just-bash 3.4.2**, published **2026-08-22T03:28:27.717Z**. Current/latest and explicit old-version endpoints returned identical8,127-byte JSON records, SHA256 **ef19c2318535bde2774c58b2ab7501178b6227e8cba98071bcb0ebdcc69d84b1**. There is **no newer published-version delta** from the old pin at this observation; this does not relabel historical results as current execution.

- Registry provenance names immutable commit **a021f95f53f7e01df48dab71b46ffd4637fb4b53**, committed **2026-08-22T03:12:15Z**, tree **c94265f9a1d16f97393633ef93e963affecad855**.
- Published tarball URL: https://registry.npmjs.org/just-bash/-/just-bash-3.4.2.tgz
- Published integrity: **sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==**
- Published SHA1: **abc0520ad5c278eae2de4cd90c3d7f88e1fdd724**; registry reports955 files/22,583,023 unpacked bytes.
- No gitHead field is supplied. The registry SLSA statement's subject SHA512 matches integrity; immutable GitHub package metadata and30 source blobs matched tree sizes/modes/Git hashes. **No independent signature/transparency verification, tarball download/hash verification, installed closure qualification or pack reproduction.**
- Old tarball SHA256 **f3a90ecffb1150e786201d9bd408ae30bcc1f64f3b10b7de22353f7e1373841d** is inherited, not rehashed or assumed equivalent to a different digest algorithm.

Exact URLs, retrieval dates, byte sizes and hashes: SOURCE-RECEIPTS.json. Published metadata/provenance: BASELINE.json. Official anchors:
https://registry.npmjs.org/-/package/just-bash/dist-tags
https://registry.npmjs.org/just-bash
https://registry.npmjs.org/-/npm/v1/attestations/just-bash@3.4.2
https://github.com/vercel-labs/just-bash/commit/a021f95f53f7e01df48dab71b46ffd4637fb4b53
All dates UTC; registry responses freshly retrieved August29, not inferred from a search-engine relative age.

## Requested support: docs versus source

CAPABILITIES.json separates documentation, authenticated source and **runtime evidence NONE** for all14 requested tools.

- **sed, rg, printf, nl, cat, head, echo, find, tail, ls:** bundled registrations and implementation files inspected. Not native/full-flag parity or workflow passes.
- **curl:** actual implementation enabled by library network configuration OR injected SecureFetch. The README's interactive shell has a different default-network claim. Supplied SecureFetch replaces built-in secure fetch; a mock implementing policy itself cannot prove comparator policy.
- **node:** opt-in registration resolves to nodeStubCommand, returning1/empty stdout and a direction/help for js-exec. Not a functioning Node CLI. **js-exec** is separately named QuickJS/WASM in a Node worker with Node-like shims—not SafeJS, host Node or equivalent Node acceptance.
- **git/apply_patch:** no bundled registry entries or dedicated command directories found at this commit. Host customCommands are extensions, not bundled support. npm/npx remain excluded product requirements.
- **Filesystem:** InMemoryFs, OverlayFs, ReadWriteFs and MountableFs are documented/exported. Custom asynchronous IFileSystem support is not deployed S3/WebDAV qualification; no such adapter files in the inspected src/fs tree. No external/private integration inspected.
- **Dependencies:** registry/source agree on16 runtime plus2 optional dependencies. **Not zero-dependency.** Opt-in activation does not erase installed dependencies; counts prove neither safety nor performance.

Concrete **source-only** risks retain useful comparison inputs: P06 sed groups -f scripts after -e; P07 -i.bak discards the suffix and writes only the original; P08 -s is refused; P19 rg chooses stdin by nonempty decoded length; P23/P24/C06 curl -D is refused. No executed failures/scores inferred. Do not remove those inputs to manufacture common-subset wins.

## Existing31 identities:24 workflows plus7 controls

CASES.json immutable commit **5d432becbe385eb323c10feecfa5e982bfd3b099**, SHA256 **68a4def2ab0186cdfb4d3715358757a23bb7a2599c8c6ac579fd07f2b5b441da**. FIXTURES SHA256 **2784e925e57619b9e0a1285c890f09293345ea414fee27a8d9aa507bfe0e00f1**. Four original manifest bindings verified; seven selected local inputs postchecked unchanged—not a full peer-directory census.

WORKFLOW-MAP.json binds every unchanged row/script/expected-object digest:

| Group | Identities | Fairness disposition, not results |
|---|---|---|
|18 core CLI/FS candidates|P01–P17,P22|Meaningful exact byte/status/FS comparison after admission. Preserve known unsupported flags and literal find child argv. Whole-row qualification still needs authentic stage/dispatch observations.|
|4 stdin-adapter candidates|P18–P21|Exact bytes/omitted-versus-empty semantics can be compared. Comparator string stdin does not certify target iterator/next/return counters: UNQUALIFIED.|
|2 network workflows|P23–P24|Explicit opt-in and deterministic mocks; unchanged header/output/request expectations. Completed-body fetch API is not the target streaming-cleanup API.|
|2 target refusal controls|C01–C02|No utility success credit for shared non-support or fabricated matching diagnostics. Separate refusal profiles/consumption observations.|
|1 readonly control|C03|Equivalent readonly VFS and no-publication census first; target exact EROFS diagnostic is not automatically portable.|
|1 read-fault control|C04|readStream versus readFileBuffer boundary mismatch needs versioned fault mapping and stage-exit witness.|
|3 lifecycle controls|C05–C07|No demonstrated equivalent raw-reason/acquisition-cleanup/owned-sink/opaque-authorizer API. Target-only until separately approved semantic mapping.|

**No full row is qualified here.** Keep exact stdout/stderr/status/FS oracles; unavailable observation channels stay UNQUALIFIED rather than weakening bytes. Comparator string output/encoding tags/public UTF8 conversion require fixture-specific representation proof, never generic arbitrary-byte UTF8 roundtripping. Enumerate bounded engine scaffolding separately from the target whole-root fixture oracle.

These31 contain **no git, node or apply_patch positive workflow and no JS guest evaluation**. Future agent JSON/file-edit comparison requires explicit equivalent programs and actual qualified engines. Never silently rename js-exec into node/SafeJS.

## Minimal next evidence barriers — proposal only

1. Keep old3.4.2 pin; no install/update warranted merely to chase latest. Before reuse, match published integrity to already-held archive and complete offline dependency/assets/modes closure. Verify provenance signatures before claiming cryptographic publisher attribution. No such action authorized here.
2. Different-review deferred V7-r3 ordering/guard repair, then obtain a **fresh one-shot runtime-admission grant**.3843-file metadata is not actual closure/load proof. Preserve exact consumer/worker edges/source guards; no broad builtin allowance, fallback or old-token reuse.
3. Authenticate installed/moved entry/dependency/worker/assets loads and natural closure, with unbound-load/fallback/tamper/nonzero/false-PASS negatives. Getter-unavailable profile remains non-stock Node and not caller authentication; this audit grants no production capability.
4. Preseal minimal18+4 byte/FS adapter, scaffolding census, terminal conversion, stage witnesses and resource-policy differences. No timing/safety comparison without equivalent work and observable accounting; missing channels remain UNQUALIFIED.
5. Add P23/P24 only with separately qualified deterministic mocks and actual built-in policy boundary. JS/Node need separately qualified provider/program contracts; Git/apply_patch need a coherent later target candidate, not accepted78 presence assumptions.
6. Admission success would still **not authorize99 semantic calls or31 identities**. Fresh root selection/freeze/GO, finite cleanup/full captures and safe failure aggregation remain separate barriers.

## History and scope

Preseal **47810329**, SHA256 **cdff5499b564d4e62b574e14c0184da865e98e9c4da742e6e66588d4011282ab**, before checking but after instructions/discovery; not pre-source/preappearance. VALIDATION.json records inert checks/tooling and preserves a report-draft syntax failure before writes/children, corrected without rerunning metadata or any cohort.

Original222/224 versus155 and13/54 versus47/54 remain historical—not overall superiority. Accepted78 **67eab12e315054907ef4ef435c6bbca2f59e0c36**, pack **6608d255828d1a4f3b2810ef6c32a2b0b57a9aaf0dd685597ce6725d381d6e06**, is inherited, not reloaded. V7-r3 f7b9f0d4/9b6c8a04 remains deferred; consumed grants, failures, missing bytes and W07 qualifications unchanged. **No product/comparator/engine/native/private/build/install/tarball/benchmark execution; no empirical/performance/safety superiority claim.**
