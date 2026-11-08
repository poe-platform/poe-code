# Independent public Node integration review — 2026-08-29

## Recommendation

Recommend **qualified opt-in public integration acceptance** of the exact selected
candidate below. No integration product defect was demonstrated. This is a
finite functional/source/package review, not root acceptance, a whole-project
gate, complete Node compatibility, or comprehensive resource enforcement proof.
No product or shared-document file was edited.

## Immutable composition and admission

- Integration source: `bb4dd0571a0335b20e29448bf88126ca02c1a32d`.
- Author evidence: `30ac56acbf12a69b90e1923810958bcbcf367fe0`.
- Selected derived tree: `a6d20781d3c099fb7b3d36c10696beb06615af1b`.
- Accepted Unit2 base: `26215b99cb379a9f825f803454f758fab5a3c8e9`, full950
  SHA256 `1fafce728b6346db4555449ba6259694346983d877a32e917fd7a15c6ebe64e4`.
- Accepted Node module: `a2f3983da537b95bed65b8bc727ab93bc7e98ca3`;
  root module acceptance `b10faea3e04714dbddc796971a773fa0c61495f7`.
- Main independent preseal commit: `f3541cc3bd67a7f9c6e95d4fc5521cee5744aabe`;
  `ACTUAL-PRESEAL.json` SHA256
  `c9f9f5589961299b248472b84de13c94d8fbaf180dc95df7eba615cf01e4cb92`.
- Executed `RECIPE-v2.json.gz.base64` decoded gzip SHA256:
  `373af09f10bf6a8ed3eaee614a79abe15cea7b75e502f1ba9281e766f8348f13`.
- Supplemental preseal/main evidence commit:
  `1b9b8c89b6aef52ece4c316d6042b0f5075dcf9a`;
  `NATIVE-PRESEAL.json` SHA256
  `e39e3b08eecf69adacded7bdb0bcb9814aedbb2928e89294d3c6682f0909a849`.

All 308 selected source inputs were authenticated, including 292 base inputs
and 16 Node files. Canonical tree bytes were recomputed; a derived tree was not
required to exist in Git's object database. Base differences are exactly
`README.md`, `package.json`, and `src/index.ts`. Fourteen Node TypeScript files
remain byte-identical to the accepted module; the fifteenth, `index.ts`, retains
the exact `function local`-through-EOF implementation and adds the authorized
imports/type/factory wrappers. Node documentation has its disclosed integration
delta. Mutable HEAD, Unit3/Unit4 and unrelated source changes were not overlaid.

`SOURCE.json` SHA256 is
`8371452bb024f99763c9240b42cb891cabe1311afafb32766e0ea24da09c6949`.
`BINDINGS-v2.json` records the source comparison, 70 derived-tree checks, selected
fixtures and exact recipe deltas. Its `sourceExecution:false` describes that
preparation receipt, not the later actual replay.

## Actual results, with denominators kept separate

| Cohort | Source-built | Offline installed | Physically moved | Total |
| --- | ---: | ---: | ---: | ---: |
| Retained selected-base workflows | 217/217 | 217/217 | 217/217 | 651/651 |
| Current version-mapped module cases | 61/61 | 61/61 | 61/61 | 183/183 |
| Public cases: 21 original + 3 corrections | 24/24 | 24/24 | 24/24 | 72/72 |
| New independent I01–I12 | 12/12 | 12/12 | 12/12 | 36/36 |
| Main expected outcomes | 314/314 | 314/314 | 314/314 | **942/942** |

These are expected outcomes, including refusals and lifecycle/error controls,
**not 942 successful guest commands**. The 217 retained cases per layout are
45 public + 28 apply_patch + 48 redirections-v2 + 50 strict + 16 prior novel +
12 indexed-array + 18 coherence cases. They do not close the accepted base's
eleven OPEN identities or certify current Unit3/Unit4.

The 61 module cases are 34 focused controls and 27 Worker cases. Their existing
F16-v2, F17-v2 and W23-v2 versions are used explicitly. The public rows use the
corrected P06/P07/P17 fixtures, not a rescore of their original failures.
P13's existing BOM subchecks do not add cases to the 24 denominator.

Strict production build, scripts-disabled offline pack/install, and physical
consumer relocation passed. Six Node public type processes passed: three
positive consumers and three expected-negative compilations, with exactly six
negative diagnostics per layout (18 total). The positive consumer explicitly
imports five Node types; it is not an exhaustive instantiation of all 21 declared
exports. The complete declared surface is source/declaration-reviewed. Six
retained Git type processes also passed,
with their own 18 expected negative diagnostics. These are not a replay of the
module review's old 72-type or 38-family denominators.

Three loaded integration mutants were detected and restored: missing root
export, forced replacement, and missing returned definition. The missing/changed
load-binding refusals also passed. Mutant failures and their restorations are
separate controls, not additional main-case successes.

### Additional native package resolution: I13

The main runtime harness authenticates root/subpath loads through an explicit
test alias map. That proves loaded package code, but alone would not test native
package export selection. The post-main, pre-execution I13 seal addresses this
specific limitation without adding a guest or engine run.

The exact already-built 1010-member tar was freshly rehydrated as regular files
under a consumer's `node_modules`, then the whole consumer was physically
renamed. This was **not** another npm install or reuse of removed scratch.
Node's native resolver selected both public names before the load guard checked
hashes; no alias map was present. Both layouts passed (2/2): nine identical
runtime values, default80 excluding node, inert factories, and four exact
private-path `ERR_PACKAGE_PATH_NOT_EXPORTED` refusals. Each loaded 248 files.

A package-metadata mutant changed only the subpath's runtime import target to
private `host.js`, leaving its declaration target unchanged. Native resolution
observed the wrong target; the consumer failed with
`NATIVE_PUBLIC_EXPORT_MISMATCH`. Restoring exact original package bytes restored
the positive result. This is one additional mutant/restore, not part of 942.
Thus the report has **942 main + 2 supplemental positive layout outcomes**,
four total mutant/restore pairs, and two binding refusals. I13 makes thirteen
new independent identities, below the sixteen-identity cap.

## Public/source boundary

The single exported subpath is `virtual-bash/commands/node`; private implementation
paths are not exported. Root and subpath expose nine runtime values and 21 types.
`createNodeCommands`/`nodeCommands` require an explicit provider;
`NodeCommandsOptions` adds checked `replace` and strips it before constructing
the command. Configuration is snapshotted. Duplicate registration preserves
the existing asynchronous Shell setup-failure boundary; the old registry entry
is preserved. Explicit replacement works. No `AgentCommandsOptions.node`,
automatic registration, registry stub, or default-count increment was added.

The seven grants remain denied by default and the 24 limits remain fixed.
Accessors/unknown options/invalid grants are rejected without provider
preparation. Independent controls cover grant snapshots, inline versus source
read authority, one-shot stdin EOF, no invalid-config acquisition, and an actual
Worker-created asynchronous observer rejection carrying exact `undefined`.
That observation is awaited through cleanup; caller signal remains live and
Worker exit is joined. I07–I09 exercise actual public-engine VFS/stdio paths;
I11 exercises an actual Worker with no guest entry. Stub controls are not
credited as engine executions.

Accepted Q01/Q02/Q03 implementation is unchanged: explicit outcome provenance,
owned asynchronous publisher/observation jobs including undefined fault presence,
and genuine FsError selected own-data fields while stack/cause are ignored
without reading them. Their version-mapped focused controls were replayed, not
replaced by public wrapper assertions. This does not sandbox malicious host
providers. Host protocol types, static entry URL and identity strings are host
integration mechanisms, not byte authentication or access authority. The strict
test loader is test-only, not a product authentication feature.

The complete package has zero runtime dependencies, no vendored engine, and no
ambient engine auto-import. PUBLIC95 emissions plus one public package metadata
input were authenticated for tests only; no engine compilation, private source,
network, native oracle, product subprocess fallback, npm/npx command, or current
whole-gate run was used.

## Source / declaration / runtime identity

Fresh full package: **1010 members, 922502 compressed bytes**, SHA256
`274839729aa916767d1664e0ec7a84579eb1c6e7eba677535dfe6273f5f079a9`.
The ordered JSON member array (`path,mode,bytes,sha256`) SHA256 is
`9537bfbe6547c39aa6a2e65ac4060de5eeb8f8bc32fa8ea84b70fbcbd8d7db01`.
This is the full package, not only a selected Node projection.

| Input/output | SHA256 |
| --- | --- |
| `src/index.ts` | `92134da7ecf6cd55e5ffa632daf314590496c89ba52b596a9509ad987bfe38fc` |
| `src/commands/node/index.ts` | `b55193aceb8d2f960a444372166bfef598fc5bfec5f53159d49363035bb7b6ce` |
| `package.json` | `58b4a3498274a8901f98d6a290671251fa8ca292d72bd5c4987bc8ec8e15411b` |
| `dist/index.js` | `34c9a052d0c21b89a106f01caebd655d8c8bd8baa31e2d530760ba7e050703cc` |
| `dist/commands/node/index.js` | `56795464372aa8ee1f3706ec985e85adeecd0a5209e0f74e0ead4d08af10f875` |
| `dist/commands/node/index.d.ts` | `5604fd1d0fef4c04720ad25b22a57c728930f8700a774423373124dcfe0070f6` |
| `dist/commands/node/worker-main.js` | `2ef280342b55c028c8e35e0f6cc98c9bf45c580134c9f0ada078815da1b3820d` |

All three public type layouts loaded the listed Node declaration hash. Raw main
load records total 22519, with 348 distinct admitted paths per normal layout
(product, fixtures and public engine combined), not 348 distinct product modules
or guest entries. Mutation controls are separate. Normal/runtime/declaration
paths bind the selected emitted tree, not live `dist` or source fallback.

## Historical corrections and limitations

`AUTHOR-CORRECTIONS.json` audits all 370 immutable author archive entries by byte
count/hash. Author v1's missing tool-binding access and v2's overly narrow engine
path admission each stopped after one closed development-metadata child, before
compiler/product/Workers. These are captured retired setup defects, not evidence
of product failure or unknown retirement.

Author v3's P06/P17 invented an inconsistent `entryReturned` plus no acquisition
receipt; the module correctly refused it. Corrected fixtures observe a real
authorized provider. P07 assumed registry identity equalled the caller's input
object, although the registry copies definitions; the correction snapshots the
actual registered entry. A type predicate omitted `| undefined`. The original
collision mutant removed only preflight, while registration still rejected;
its original/restored result is not credited as a valid discriminating kill.
The corrected mutant forces replacement at both boundaries. These fixture/helper
repairs are within root's requested version mapping, not product fixes. Original
public failures, type failures, mutant failure and all raw captures remain.

Our preparation m01 guessed a nonexistent DESIGN.md locator. The closed Git
batch's 9081 raw bytes are retained in `m01-RAW.json.gz.base64`; corrected immutable
inventory/handoff lookup supplied the actual inputs. No product had been
admitted. Initial DATA assembly also duplicated a permission prefix already
supplied by the loader helper. The unexecuted original recipe is retained beside
v2; the fix preceded committed activation. Neither was a safety/capture/integrity
or unknown-retirement failure. Main and supplemental actual runs needed no
post-execution fixture correction.

Inherited qualifications remain: restricted **NP1-CJS-WRQ-L-SYNC-1 / Worker-L**;
no full Node, ESM/.js/TLA, async fs, process.exit, package search, npm/npx,
Promise-constructor support, all-jobs-settled, RSS or whole-guest-8MiB guarantee.
The 16MiB command ledger, 197056-byte SAB, V8 limits and five-second admission
policy are not a universal memory/time bound. W23-v2 observed its actual callback,
but old loop telemetry and diagnostic fault detail remain UNKNOWN; this replay
does not explain them. E09's weaker assertion, the old 38-family partial coverage,
unexecuted variants and earlier raw failures remain open/qualified. This does
not convert module acceptance into full provider or host authorization proof.

## Resources, cleanup and accounting qualification

Main actual ran 06:59:18.994Z–07:02:46.760Z. Its 71 direct child records all close,
with no signal, spawn-error or capture-error flags. The owner and launcher also
settled. Raw resource streams independently reconcile **151 Node Worker creates
and 151 exits**, across 33 streams; no unmatched IDs. Guest entries: **133**.
Regex Worker observations: **0**. Fixed internal-loader admissions: **23**.
Known Worker/admission categories: **174**, not an actual concurrency or live-peak
measurement. Individual internal-loader exits are not observed; their containing
processes close. No arbitrary uncooperative-host cleanup claim is made.

I13 ran 07:11:01.085Z–07:11:04.245Z: four closed target children plus coordinator,
no signals; no Worker permission or provider preparation/guest admission. It
adds zero Worker/guest/fixed-loader admissions. Its two positive consumers,
mutant and restore each loaded 248 authenticated files. All owned source/build/
install/mirror/supplement scratch was removed after settled success; raw evidence
remains. There are no active review child sessions.

Recorded execution roles are **78**: main 71 children + owner + launcher =73,
then supplement four children + coordinator =5. This is **not** an ALL-process
census. `PREP-RESULTS.json` records 24 known preparation admissions, separate
conservative editing/publication reserves, six closed metadata children and
20727294 captured bytes. Actual administrative editing/Git/tool-host processes
are not joined into one complete transitive OS census. The 48 reserved actual
administration slots are an admission allowance, not 48 measured processes.
Therefore exact ALL-process cap/peak compliance is **not established**, despite
recorded role totals being below the declared envelopes. No prior accounting
gap is relabeled solved.

Main owner capture is 7635823 bytes, cumulative scratch writes 53149005 bytes,
and terminal scratch size 85847298 bytes; outer capture is 747 bytes. I13 target
capture is 284394 bytes and its binary hash reads 112989184 bytes in 64KiB blocks.
These are scoped counters, not complete phase-wide allocation/I/O/RSS totals.
Publication/archive/DATA/tool-host copies are not all included in owner counters.
The finite observed results are recommended with these limitations, not as
global resource-limit validation.

## Durable evidence and reuse

- `actual-v1/EVIDENCE.json.gz.base64`: 319 independently verified members,
  22142784 original bytes; gzip6610483 bytes, SHA256
  `f9ac0cb4605a23cc9a1f2702413ef5a153393ff20c0c88e01378172b49438b6d`.
- `actual-v1/RESULT.json` SHA256
  `f1040cf963e89ef7e2f160ccf23bb72afc46f7e72dcc1f144f116723f795b196`.
- `actual-v1/TERMINAL.json` SHA256
  `c6ee8728df03f58ea4be77787ca5900cf2e3d7cd745c5557b84fdacf924b63e0`.
- `native-actual-v1/startup.json` SHA256
  `b0cca62a750da2800b87a1188fc264b82f9e17aba85aaf9a55d9ad1ba87ed5af`;
  adjacent raw stdout/stderr preserve native resolutions and the mutant failure.

Owner RESULT schema/status strings retain the reused author-runner names;
they are not root acceptance assertions. This report supplies the independent
judgment. Replay requires a fresh output namespace and a fresh bounded grant;
do not overwrite immutable captures or automatically execute archived recipes.
