# Filesystem inspection: bounded independent handoff

## Decision and ownership

The authorized cumulative-safety gate has six scoped passing observations:
**four original valid rows reused without replay, plus two freshly executed
DERIVED corrections**. Original v1 DP/sort remain **HOLD, zero invocation**.
This is not six passing original v1 rows, a new blind corpus, full native parity,
a full project gate, performance evidence, real-provider certification or
superiority evidence. Earlier sealed READMEs retain their historical status;
this additive document is the current navigation, not a rewrite of history.

**Readiness proposal for root consideration only.** This leaf neither authorizes
Plato nor assigns integration ownership. No root exports, package subpaths,
defaults, aggregate registration, shared executor, FS/contracts or product source
were changed. Root must separately assign/authorize integration and verify any
resulting public consumer; this evidence does not preapprove those changes.

## Frozen identity and evidence map

- Safety/tree source: `436bda3e21b2b6041409fac7408cf072b5d3fe5e`.
- Independent file40 source: `cd37ce07c1f41f3797e19e0f701b662823338843`.
  All three file TS modules and its README have identical bytes at436bda3.
  Whole-Shell snapshots are not thereby claimed identical or an isolated causal
  experiment: committed Shell lifecycle changes belong to the full candidates.
- Tree evidence commit: `a31b7c36eef00c41763875c863a559594049f13f`.
- File evidence commit: `ddd01cda4dd460f0da7be9cc9d091ff6febbc7e9`.
- Earlier peer seal: `2070378359e479e7b589d46705d4275181ae0ad2`.

`SOURCE_BINDING.json` records every owned source-module/README SHA256, Git blob,
byte size and emitted entry/declaration hash. Its method is exact `git ls-tree`,
`git rev-parse COMMIT:PATH`, `git show COMMIT:PATH`, SHA256 of raw bytes, and
comparison to the isolated approved regular-file snapshot. No source/compiler
payload was copied here. `REFERENCE_INDEX.json` binds30 committed source-owner
and original/final38/40 evidence references, each byte-compared to that commit.
Their manifests retain the detailed raw rows and historical native data; those
foreign corpora are referenced, not recopied or modified by this leaf.

Source-module SHA256 values (relative to `src/commands/`):

| Module | SHA256 |
| --- | --- |
| tree/arguments.ts | `848b3e07aafefc67de77efccaa446904d9a1920cb158e094217c18e24a6a2762` |
| tree/index.ts | `cdd900d8e489736ec860aa55dfc7013e01c3dba797cbe51ec1a4366120b9cefc` |
| tree/io.ts | `163f2412e5fcca1dc0cd0ac7264beb29b8180efdd65c34fdff08f84a670471e1` |
| tree/options.ts | `8eefe8b28a9341af79e22714ab9898abf07d04fb0a5f99773c822a4432369483` |
| tree/pattern.ts | `114de00a12f9e32e0593a22abe753d27e079fe504e13e8b35289ae90afdbb215` |
| tree/tree.ts | `2ebcf54d9804e7000bf3de4780d598b8b6bc157ee411c134dea5c62717738ef1` |
| file/classify.ts | `fcdee375d2f97afae9d8dc6a23eff64440258aea0a8c2adff7b2968875bc6535` |
| file/index.ts | `5278a91c223e182a6bfd2961b16545ff42e2f4e986c25f5dc7f35371aee0d178` |
| file/shared.ts | `bb6d9ac67eeace8e52220c94f7eb2d78236fe045d3d1312814c5b9dcb0755fc5` |

Safety snapshot `/tmp/safe-bash-inspection-final-YZxhi8/snapshot` is ephemeral,
not a durable distributable. The independent source-only build provenance and
920-file source/config/emission manifest are retained under `safety-run-evidence/`.
All920 hashes verified before and after both authorized phases. Product module
loads were restricted to the declared entrypoints and recorded/rehashed; the
static28-module union closure requires only `node:util`, `node:stream/web`,
`node:path`, `node:timers/promises`. No native libmagic, process, FS or network
access is provided by these commands. This loader is not a host-JS sandbox.

Compiled safety entrypoints (snapshot-relative):

| Entrypoint | SHA256 |
| --- | --- |
| dist/shell/index.js | `e4727274e08ff8199102d4826579aaf410b3a72b3a4e0c4dc8864a57bc714afb` |
| dist/contracts/index.js | `7e494e421356e368da43cab478f595600127d8ee345a887838f40bffe2757d27` |
| dist/commands/tree/index.js | `702a5d511ede375a30473275f8428b84f7b4c44b7caa706ba3796d5e9b94140a` |
| dist/commands/file/index.js | `2f63be99b23805e68498f39b71382134d70ab2929f7413460337790d8d3e5ad5` |

## Evidence denominators — do not merge lanes

| Lane | Qualified result |
| --- | --- |
| Tree source-author tests |77/77 reported by source owner, not rerun here |
| File source-author tests |72/72 reported by source owner, not rerun here; saved TEXT subset is17/17 |
| Original independent tree38 at e2d1b923 |30 raw passes,2 failures,3 unsupported,3 characterizations |
| Final independent tree38 at436bda3 |31 raw passes,1 accepted-profile raw failure N16,3 unsupported,3 characterizations |
| Tree native20, original/final |12 exact,5 differences,3 unsupported/not run; captures reused |
| Original independent file40 at d168 |35 raw passes,3 harness failures,2 backend limitations; adjudicated31+4 profiles+3 harness defects+2 limitations |
| Final independent file40 at cd37 |35 passes+3 native-profile conflicts+2 backend limitations; raw38 passes+2 limitations |
| File native final machine views |52/60 exact: combined17/20,type18/20,encoding17/20; original50/60 |
| File human views |20/20 semantic,4/20 exact characterization only; not20 exact passes |
| Safety v1 original execution |4 passes+2 HOLD;4 actual commands |
| Safety derived execution |2 passes;2 actual commands, four previous results reused |

Tree final38 made35 actual calls plus one separate typed built standalone plugin
smoke; the independent tree worker compiled all15 canonical owned TS inputs.
File final40 made100 direct execute attempts and5 Shell calls, not40 individual
command invocations:96 direct results/4 expected rejections,4 Shell successes/
1 expected preabort,5 disposals. Its READY build/type pass was reused, not rerun;
no separate built standalone consumer was run by that independent file worker.
Source-owner build/consumer checks remain separately attributed. These counts
are not added to this peer's exactly6-command safety cap.

Final file F29 uses active real FS-entry signals, not Signal object identity.
F33/F34 preserve exact caller-reason identity and FS signal aborted/reason,
next1/return1, two genuine late-read injections and one additional F34 late-return
injection, with finite zero-unhandled observation windows. F35 preserves byte
ownership/backpressure and sink-error propagation. Original defects and v1
overconstraints remain in their historical files; composition was not disabled.

Key original/final cohort hashes:

| Artifact | SHA256 |
| --- | --- |
| tree original38 result | `a1cde249bbe1fa2e9a8f049d848a28d12741a3305c0865056d956dba6ff04498` |
| tree original evidence manifest | `66ecd953ee0959f249387b3eab9f7d9f20afa32eca36bb123a82810187997b01` |
| tree final38 result | `c682156302cb2a077962c6d9ca0c6be5ee914dc5c657bcb7176ba71b20907b99` |
| tree final manifest | `f5d0e4c69a0c7d797e77b0af89a6cc471ce4f39496a747a56d0d682597839d7b` |
| file original40 summary | `75adba94dd37d5c1bc331a1aa9a6f3e9c5bd87b621317802c70d0dae4f872dd1` |
| file final40 summary | `e39390bfc1beb76e84dd68cab325803720d5ebac0b38fb1f1fcbfd5088a7798a` |
| file publication manifest | `b75c303e98902f1c937e976bfa587308e223e3261f0227c9e33f7a99921857e0` |

## Explicit dialect/profile gaps

Native references are the recorded tree2.2.1 Darwin arm64 C/ASCII profile and
Darwin file5.41 captures, not fresh native executions or GNU/Linux evidence.

Tree N09 `--prune`, N12 `-N` literal-name output and N19 native per-directory
`--filelimit 2` are unsupported/not run, not passes or equivalents of family
budgets. A24 missing mandatory realpath explores a nonconforming provider;
A25 pathlike/dot/empty/NUL names and A26 duplicate entries characterize provider
boundaries. All three remain characterizations, not success cases.

Native differences remain N14/N16/N17/N18/N20:
- N14 follows sibling aliases independently using ancestor-only cycle handling;
  the captured native result suppresses alias-b as recursive. Chosen profile,
  not exact parity or a literal user-mandated global identity policy.
- N16 explicit root symlink is not traversed without `-l`: native displays its
  child; product displays the link/target. Accepted profile, raw failure retained.
- N17 missing root plus regular-file root: product status1 and meaningful stderr,
  regular file as leaf; native status2, empty stderr and error-opening-dir labels.
- N18 zero depth: product usage status2 with positive1..256 range; native status1
  with different text. Corrected semantic diagnostic predicate is not parity.
- N20 parsed JSON names/schema compare semantically; whitespace differs.

File F07 invalid UTF-8 at EOF and F18 truncated six-byte PNG remain native
text/plain+unknown-8bit versus strict octet-stream+binary. F12's actual frozen
ASCII PDF has matching application/pdf but native us-ascii versus binary.
F30 refuses known oversized readFile before reading; F31 lstat ENOTSUP is a
backend limitation without a read. Neither is successful classification.
F16 registered application/vnd.sqlite3 now matches all three machine views;
SQLite MIME correction is separate from TEXT and signal-harness corrections.
Author PE and WebAssembly specimens were **not independently run**: author
native application/x-dosexec versus application/vnd.microsoft.portable-executable,
and application/octet-stream versus application/wasm remain qualified profiles.
The author's different iso8859-1 PDF is not substituted for independent F12.
Author corrected26-fixture results24/26 plain MIME,23/26 combined and26/26 human
semantic are separate from the independent20-content-case denominators.

## Six bounded safety observations and derivation

Original authorization `e4d048afb4784f802047de589212519465bb7589ccdb99e10ba677add39cee1c`
retained both invalidated proofs. Original runner ran once and returned4pass/
2HOLD. Its raw summary is
`67eb07af4da1452bce7f7751882d4ed6195fbf91aee016510850f3bc8dcd4465`.
The first invalid assumption was **singleton4573>sealed4096**, so original DP
could not test cumulative many-entry admission. The other was that actual
Shell would reject its promise with empty stderr: it instead resolves status1
and a human diagnostic for this ordinary command error. Neither required a
product source fix. Original calls/statuses/seal/inputs remain intact.

Root authorized only an additive derivation: same DP64 names/pattern with
maxSteps16384, same sort inputs/budget4096, and actual Shell status1/work diagnostic.
This is **DERIVED, not new blind evidence**. Independent peer rechecked exact
diffs, fixed arithmetic, phase telemetry and two-child gate before authorization.

| Row | Actual observation |
| --- | --- |
| Original T-empty-many |all64 names; exact8262-byte stdout; rowless empty alternatives with charged alternatives |
| Original F-JSON-cumulative |two8190-byte samples; only first29-byte line emitted; cumulative step limit26-byte stderr |
| Original F-header-many |32 paths×512 bytes;1192 output bytes; bounded classification, not format certification |
| Original F-metadata-many |one lstat/readlink; zero content read;28-byte limit diagnostic; first admission only |
| Derived T-DP-cumulative |status1,stdout0,stderr55; first4 names,next4,done=false,return1; only root lstat/readdir |
| Derived T-sort-many |status1,stdout0,stderr54; all64 names,next65,done=true,return0; only root lstat/readdir |

DP singleton4573 fits16384; three full filters13606; four would18123. Fourth
filter token10 leaves16317; token11 demands16575 and fails before its row
allocation. The partial listing trace rules out a later-sort false positive:
sorting begins only after listing exhaustion. Sort starts at66; full-span
comparison reservation1025 yields3141 after three, then4166 attempted at the
fourth. The dirsfirst second pass is statically metered but not dynamically
reached here. These are budget units/static causality, not measured instructions
or an invented exact sort-comparison count. `safety-v2/STATIC_PROOF.md` and the
different peer proof preserve the limits of this attribution.

Derived authorization:
`86d99b7d185bdd6e51e61b8476316346c00ab709f5ae39bdba80780f6a92453a`.
Approved independent proposal:
`e9612864715f8894945f771674016826d0a05a5ef9d44a1ac37e8def3db6cffd`.
Independent proof:
`c072c58a4a96606091fdea1c41bb7cedf1e262e2a7383a95a1100ac95d656216`.
Derived raw summary:
`a17a55919f1d253554785f77417f564cc925eeb0d0fb6b27c1c8f7e70ce8f3ec`.
Original PRESEAL/runtime:
`b72b5e9f109e3da38732c931980d3730bbda14dc0eef16cdea7c3fa632e92ebb` /
`428424f50da19fcbe970f962f8149eb9674dccd475db7e720b52d83c1b1d4905`.
Derived SEAL/runtime:
`8111403a37f392dd8934c3e0f9d89bc6b8338bf5d14becb3471bc68a6ee682df` /
`f29c603e3205e69716d6fafff4b256d128c981cd010fc8c0021d604ae2c06b77`.

Both derived children99040/99041 closed naturally code0/no signal; Shell disposed,
one command each, zero mutation/unhandled rejection, no unknown partial outcome.
They observed heap134217728 bytes; maximum RSS85573632 bytes; transport warnings
448 bytes each, separate from product stderr. Same5s child/30s batch/128MiB heap/
256MiB observed-RSS stop/64KiB capture, zero retries/native calls. Six command
starts total across phases; four were never replayed. No SIGSTOP or forced kill.
Root's wrong v1 marker copy was corrected **before any call**; it is copied as
unexecuted coordination preparation, not a product failure. The exclusive
execution claim is retained; host deletion/bypass is outside its cooperative
guarantee. No new product checks were run after the two passes.

## Standalone API/options proposal from frozen modules

Inspected source README and emitted declarations, not invented root exports:

| Family | Standalone module exports |
| --- | --- |
| tree | `treeCommands`, `createTreeCommands`, `createTreeCommand`, `TreeCommandsOptions`, `TreeLimits` |
| file | `fileCommands`, `createFileCommands`, `createFileCommand`, `FileCommandsOptions`, `FileLimits` |

Both options interfaces expose `replace?: boolean` and `limits?: Partial<...>`.
The plural factory returns `readonly CommandDefinition[]`, singular returns
`CommandDefinition`, plugin factory returns `VirtualShellPlugin`; options are
optional. Plugins register only their named command, preflight collision and
default replace=false. Limits are copied/validated at factory creation as
positive safe integers; file maxDurationMs is additionally<=2147483647.
These are `src/commands/{tree,file}/index.ts` / emitted standalone module APIs,
not verified installed package-root/subpath imports or approved defaults.

Exact defaults:

| TreeLimits | Default |
| --- | ---: |
| maxArguments |4096 |
| maxArgumentBytes |65536 |
| maxEntries |100000 |
| maxDirectoryEntries |10000 |
| maxDepth |256 |
| maxPathBytes |16384 |
| maxMetadataBytes |8388608 |
| maxOutputBytes |16777216 |
| maxSteps |4194304 |

| FileLimits | Default |
| --- | ---: |
| maxSniffBytes |65536 |
| maxReadFileBytes |1048576 |
| maxInputBytes |8388608 |
| maxOutputBytes |1048576 |
| maxChunkBytes |1048576 |
| maxEntries |1024 |
| maxSteps |1048576 |
| maxArgumentBytes |65536 |
| maxDurationMs |10000 |

Independent file40 used stricter maxReadFileBytes65536, not the1MiB default.
Safety-case limits are their sealed overrides, not new product defaults.

Tree flags: `-a`, `-d`, positive `-L`, repeated `-P`/`-I` (OR), `-f`, `-i`, `-l`,
`-J`, `-r`, `--dirsfirst`, `--noreport`, `--charset=ASCII|UTF-8`, no-color no-op
`-n`, `--`, `--help`, `--version`; combined short flags/attached values supported.
Default operand `.`, `-` ordinary path, no stdin/content reads. Basename patterns
are case-sensitive UTF-8 bytes: `*`, `?`, sets/ranges/negation, alternatives and
outside-bracket backslash literals. `?` is one byte, not scalar. Slash/globstar/
malformed/descending ranges reject; sorting is unsigned UTF-8-byte order. No
untrusted RegExp construction. Default no-follow includes explicit root links;
metadata target stat can still classify links. Unknown options are usage errors.

File flags: `-b`/`--brief`, `-i`/`--mime`, `--mime-type`, `--mime-encoding`,
`-h`/`--no-dereference` default regardless of POSIXLY_CORRECT, `-L`/`--dereference`
(last h/L wins), `--`, `--help`, `--version`. No operands is usage2, not stdin.
`-` consumes stdin once, labels `/dev/stdin` without host path lookup; later `-`
is empty. Normal classifications status0; typed VFS failures stderr/status1
while later operands continue; unsupported/usage2. Native file error treatment
differs. Non-typed faults, cancellation and sink errors propagate to Shell.

## Safety/streaming limits that must survive integration

Tree renders bounded owned chunks<=16KiB and awaits byte writes/backpressure.
Metadata and output admission precede proportional encoding/escaping; JSON
fields are preflighted before stringify. Cumulative glob/DP initialization and
transition reservations span patterns/entries; sort reserves byte spans before
comparison. Error-message pre-admission precedes prefix stripping. Remaining
fragments are bounded, not zero-allocation or exact peak-heap guarantees.

Tree command-level errors/cancellation/sink failures may leave partial text or
**incomplete JSON**. Actual Shell can translate ordinary limit errors into
status1+diagnostic. Previously emitted bytes are not rolled back. VFS identity
and comparisons are point-in-time observations, not leases/ABA/snapshot/security
guarantees. Unknown identity stays unknown; budgets bound uncertain recursion.

File bounded readStream sampling preserves explicit signal, prefix, byte ownership
and early iterator closure. readFile fallback requires known admissible stat size
and forwards maxBytes, but host allocation or concurrent growth already happened
and cannot be undone. Upstream oversized chunks likewise already exist. Family
input/step/output accounting is cumulative across operands, including admitted
sample scans before decode/control/JSON inspection and metadata text before
escaping. Header sniffing uses bounded offsets, not full-format validation,
decompression or security certification. Constant regex/parser primitives see
bounded inputs, but quotas are not CPU preemption, hard heap or latency bounds.

File has a fixed cumulative64-UTF-16-unit emergency diagnostic reserve when
normal work is exhausted; it still obeys combined output/chunk/signal/deadline
limits, preserves complete codepoints, and cannot reset ordinary work budgets.
Diagnostics can be truncated or absent with no output budget. Label/field
pieces and final lines have separate admission; bounded intermediates may exist.
Parent Shell budgets/sinks remain separate from per-invocation family budgets.
Signal composition is valid: preserve exact caller reason/FS propagation, not
Signal object identity. Observe late failures; cancellation cannot undo effects
or forcibly stop arbitrary uncooperative host getters/callbacks/allocations.

## External oracle retention and remaining root work

Tree commit a31b7c3 externalizes exactly two payloads; neither is copied here:
- `sealed/oracle/tree` -> `/tmp/safe-bash-tree-external-oracle-TbVJVK/tree`,
  114488 bytes,0755, SHA256
  `34a794e5737d4b09a20a58dc0b7231e6300a3d229be5065c3a549969d205f10a`.
- `sealed/oracle/tree-2.2.1.tar.bz2` -> same external directory/basename,
  56345 bytes,0644, SHA256
  `e911c4a2bea53586cc7be6f3d7d7f4d9c2f2bcbbad77d30700b31046e38f4bc5`.

`../tree/EXTERNAL-ARTIFACTS.json` records the original private full copy and
official archive provenance. This repository does not contain every historical
input. `/tmp` can expire; archive availability was not rechecked, binary rebuild
is not claimed bit-identical. Legacy full-input verification needs exact files
restored into an isolated copied corpus, never skipped/resealed or restored to
this repo. No recovery, archive download, native run or comparator work was done.

Root may use this handoff for a separate integration decision, preserving all
profile gaps, historical holds, external prerequisites and source identities.
Any public/default changes require the actual integration owner, new consumer
evidence and root validation. No universal tool completeness, project-wide
gate, adapter deployment interoperability or just-bash superiority is asserted.
The final artifact manifest and /tmp commit receipt record exact ownership,
files/count/bytes/hashes; all previous sealed READMEs/raw bytes remain unchanged.
