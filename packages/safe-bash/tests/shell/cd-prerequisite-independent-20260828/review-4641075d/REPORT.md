# Different independent CD review — candidate4641075d

August28,2026. Review execution is complete. **No candidate product defect was
found in this scoped review. ROOT owns acceptance and any directory-stack release.**
This does not certify full Bash parity, a full gate, remote services or ACLs.

## Binding and timing

- Source: `4641075df5355a91c83bf5b2cc3a88dfaf1f5153`.
- Author evidence: `8c0c17f0f5e7670d06cd7e9a0a8da3995e970375`.
- Runtime blob: `d32239c31e5b4cdf11fd7863a407283119a209ec`;
  SHA-256 `93c06908aec9d5d61d801657f99ab75122cadb6688f038e1941c587b4a8d4ed3`.
- Binding preseal: `3d8174864eeed5c5cda4d6f1db22c2b7673b3639`, committed after
  reading the declared committed handoff and before runtime-body inspection or
  product execution. Handoff prose described the delta and author history;
  hashing runtime bytes for identity was not semantic body inspection.
- Execution source is exactly accepted5137 plus the two accepted ca1d WebDAV
  source/doc blobs, then only this runtime blob. Base tree
  `7c68831a81fc49c94ad9177e58ca9fd7d0aca352` becomes full composed tree
  `b820fa91a3bcc904005c690d48038d9a3900cede`.
- The complete265-file source/build closure, full raw commit/tree/path proofs,
  regular tools and actual package are retained. No moving HEAD or live source
  overlay entered execution. Unselected repository subtrees retain opaque Git
  references; this is not a whole-repository or ambient-scratch archive.

Original beeda18, ratification2fbd4 and preparationa9ca19 files remain unchanged.
Normative ROOT-ratification-v3 is ef833; original772/882 profile hashes remain
unchanged. This actual review follows the earlier post-author-release preparation;
it is not retrospectively described as another preimplementation freeze.

## Measured results

| Layout | Public rows pass / fail / blocked / untested | Positive / negative types | Independent negative inversions | Product modules actually loaded |
| --- | --- | --- | --- | --- |
| Source | 86 / 0 / 0 / 0 | 10 / 10 | 10 | 207 |
| Full npm-installed | 86 / 0 / 0 / 0 | 10 / 10 | 10 | 207 |
| Physically moved | 86 / 0 / 0 / 0 | 10 / 10 | 10 | 207 |

These are the same82 command and4 diagnostic rows, not258 unique controls.
Groups remain behavior16, permissions14, adapters6, state9, output5,
cancellation5, limits27, diagnostics4. No expected command, status, diagnostic,
state, call-order or cap value was weakened. Types use the original10+10 fixture
bytes, actual candidate declarations, strict/exactOptionalPropertyTypes, explicit
ES2023 libraries and the inherited skipLibCheck profile. Missing imports do not
count as negative passes; each intended TS2322/TS2375 location is independently
neutralized while the other nine remain.

**L24 fixture qualification:** its original “Memory” label cannot literally admit
the65535-byte component: accepted Memory enforces255 UTF-8 bytes/component
(`src/fs/memory/index.ts:179` at5137). Its unchanged UTF16/path/stat/X_OK/state
assertions pass through the scripted public FileSystem guard, not an actual
Memory long-name operation. Each layout therefore has85 fully bound original
adapter qualifications plus this one scripted-only qualification. This is a
frozen-fixture defect, not evidence that cd or Memory should be changed. ROOT
decides acceptance with this qualification; literal-Memory L24 is not a pass.

The package independently measures846 regular files,745084 bytes compressed,
SHA-256 `06ea635b201a1296268adaa452a2419682f92ec93906cb9083e327dc69f85914`.
It matches the author-reported hash, but was independently built, packed offline
with scripts disabled, genuinely installed and physically moved. Complete emitted
dist equals installed dist; every other package file equals its composed input.
Consumer/package/tool hashes and membership include additions and file modes.
The original installed-consumer path is absent after the final move.

Additional bounded results, not added to the86 denominator:

- **12/12 actual import negatives:** existing out-of-admission runtime source,
  missing public entry, changed runtime and changed provider, each layout. Real
  public-root imports reject the latter three at the intended admission boundary.
  Twelve earlier direct-guard predicate controls remain separately retained;
  they are not substituted for these actual imports or semantic mutant kills.
- **2/2 semantic mutants killed:** suppress CDPATH print (B01) and bypass the
  checked OLDPWD write (S01). Both use previously passing unchanged public rows,
  valid parsed source variants, authenticated actual variant loads, ordinary
  assertion failures and clean natural child settlement. No loader error is a kill.
- **20/20 unchanged existing regressions:** accepted5137
  `tests/shell/fs-error-diagnostics.test.ts`, against the composed candidate.
  Zero failures/skips/TODO/cancellations; no native helper or remote service.
- **Six supplementary adapter checks:** confined local Real and injected S3
  mock, each layout. All pass. Frozen actual Memory/ReadOnly/Mount/accepted-DAV
  controls also pass. S3's existing root ancestor listing precedes its two head
  requests and repeats for X_OK; these transport requests are not cd VFS probes.

## Invariants and integration controls

`RESULT.json` maps every row and all12 invariants/7 controls to concrete evidence.
I01-I06 and I08-I11 combine measured public effects with pinned source proof;
I07 is source-only reachability/normalization proof; I12 is provenance discipline.
There are **zero private helper-simulation fixtures** and no invented public state
getter. Work/yield counters and private post-rejection state are source-bound,
not claimed dynamically instrumented measurements.
Raw `public-pass-design-pending` labels remain untouched: the public executor
does not measure those private fields. This review closes their source-review
obligations separately; it does not rewrite the original runtime receipts.

Static TypeScript AST/text comparison independently confirms **58 other Runtime
members and13 non-cd builtin statements byte-identical**, with other top-level
statements unchanged except FsError import and the three added private CD helpers.
Consequently the checked-variable, prefix/clone, shared Budget, error/control,
caller-cancellation and cleanup implementations remain the accepted baseline.

Exact source at4641075d binds the following measured boundary effects:

- Inclusive path/CDPATH65536 UTF-8 bytes,4096 slots,4097 probes/8194 public calls.
  Missing HOME/OLDPWD and argument errors precede lookup-limit work. Absolute/dot
  bypasses and raw joins follow the ratified preflight order.
- L18:4098+4097*14=61456 work,480 full128-unit boundaries plus16 remainder.
  L19:48824+57*146312=8388608 exactly,65536 boundaries and zero remainder.
  L20's unconstrained8388609 rejects its final access charge1 after final stat;
  measured counts are57 stat/52 access. L21 has67956 remaining and rejects its
  next80004 raw reservation without partial charge/allocation or a probe.
  Reservations are subtraction-first; no refunds/resets or per-byte command ticks.
- Checked OLDPWD precedes cwd; checked PWD follows cwd; exports precede awaited
  print. Readonly OLD stops before cwd, intentionally stronger than native.
  Readonly PWD preserves the established partial OLD/cwd state. Output failure or
  abort does not roll back publication. L26 private final state is proved by the
  two exact source transitions; no third observer violates its maxCommands2 input.
- D01-D04 execute actual cd with EIO.message payloads. The executed catch routes
  those unmapped EIO messages through the actual cdDiagnostic formatter. Exact
  payload byte/scalar outputs are measured; incremental construction is source
  proof. Max65792 includes cd-owned prefix, excludes Shell origin/newline;
  prefix<=65780 plus exact12-byte suffix. O05 proves no global diagnostic cap.
  This is not a whole-line, global stderr, memory/RSS or hard-preemption claim.

F01 authenticates the exact composition and runtime-only delta; F02 is the measured
source86; F03 is the actual full package/install/types; F04 is the physical move
and repeated rows/types; F05 is the12 actual import negatives; F06 is the three
actual10+10 declaration bindings/inversions; F07 is the20 exact existing scoped
regressions. None is reported passed merely because it was configured.

## Retained nonpasses and corrections

All original raw attempts and their code/config versions remain available:

1. DRIVER01 omitted git from the isolated launcher PATH. Metadata admission
   failed; no product work ran. Corrected launcher kept the original capture.
2. Original executor reached61 public passes, then L07 failed during pure Memory
   setup before Shell/resource setup. One setup nonpass and24 source rows were
   blocked; installed/moved86 each were blocked. The child stopped naturally.
   Version2 skips unsupported backing setup and uses the declared scripted
   provider outcomes for long boundary paths; L24's literal-Memory gap stays explicit.
3. Source86 then passed, but repeated long FsError messages made its raw result
   21449775 bytes, exceeding the harness8MiB artifact bound. Version3 losslessly
   interns repeated errors; decoded traces match. The original raw result and
   failed driver remain. Completed source86 was reused, not rerun or silently rescored.
4. Source types passed, but the supplementary S3 fixture wrongly assumed only
   headObject requests. The existing ancestor root listing was omitted from that
   expectation. Corrected exact six-request sequence is separately sealed; no
   provider code or CD expectation changed. Real cleanup completed in finally.
5. npm rejected one path used as both user and global config before packing.
   Separate empty owned config files fixed the harness. Completed source stages
   were reused; packaging/installed/moved then completed naturally.

Each repair has a committed adaptation/preseal and preserves earlier nonpasses.
No timeout, surviving process group, forced kill, failed source hash or cooperative
resource leak was treated as a pass. Ordinary assertion failures continued only
with clean closure; the original setup-unknown outcome stopped that batch.

## Preservation and limits

Original native28/317 preseal/d0b evidence, accepted provider records and all author
captures—including failures—remain unchanged and are not rescored as our results.
Author87/239/42 results are history, not this review's denominator. Native C28's
status1 versus project empty-string=>dot success stays intentional; EPERM/ELOOP
fatal search and stronger readonly OLD remain ROOT-approved profile differences.

All writes are confined to the newly owned review directory. No product, package,
root export, AGENTS, private checkout or foreign staging edits occurred. All scratch,
regular tools, caches, consumer files, captures and package bytes are archived
without content exclusions, with byte deduplication only. Cleanup requires a durable
Git evidence seal and exact before-removal inventories; `CLEANUP.json` records it.
See `REPRO.md` and the read-only verifier. No further cohort or stack implementation
is authorized by this report.
