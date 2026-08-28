# Different public WHICH77 component review

## Verdict and gate qualification

Recommend **scoped acceptance of the public WHICH component** on isolated candidate
`284857d7aa9b0ee0df2b6fdd1a71f41115d7b909`, with root wiring
`ee1f69e721e350fcc77d634b92e5c9f13f61dedb`. No source defect was demonstrated.
This is not a whole76/77 gate, release promotion, native WHICH, Node24, or combined
Stage2-runtime-plus-WHICH acceptance.

The sole parent is `2ffcb23d6029250c48950030120ed0adad2e5769`. Root reports its
whole76 gate still has maintained count assertions failing/unreached and has
assigned their separate fixture-only repair. This review does not run or waive
that gate, assume it accepted, or substitute the new77 membership check for it.
Any accepted76 prerequisite for promotion remains a separate root decision.

The candidate differs from its parent in exactly15 declared paths: four public
wiring/documentation files and eleven accepted WHICH module files. Each blob is
compared with its designated `ee1f69e7` or `0902f3c5` origin. All265 selected build
inputs are authenticated against the isolated Git commit and author inventory.
There is no live-product overlay, root edit or new module implementation.

## Frozen execution and package evidence

Independent public freeze **`02ccea66` is unchanged**. The cohort SHA-256 remains
`46ed767896a6da884dbbe379ed5d2d0e5d8ff53fdb138f3ba4ad5b68377ad8aa`.
Although the author previously ran these bodies, this evidence is a separate
execution, build, installation, relocation and set of negative controls.

| Layout | Runtime | Strict type families | Authenticated product modules |
| --- | ---: | ---: | ---: |
| Offline installed package | 18/18 | 4/4 | 206 |
| Physically moved complete installation | 18/18 | 4/4 | 206 |

All positive cohorts have zero failures, skipped cases, cancellations and TODOs.
206 is the count of actual loaded package modules, **not** a case denominator;
the fixture adds one further loaded module. These are22 distinct families in two
layouts, not44 different behaviors. Only Node **22.22.2 Darwin arm64** was executed
by this reviewer. The author's Node24 runs are not counted as independent results.

The strict build passes using guarded-copied TypeScript5.9.3, @types/node22.20.1
and undici-types6.21.0 development inputs. Actual manifest `npm pack` with scripts
disabled independently reproduces full tarball SHA-256
`49191d098e1e9f5b946f24dd898377144062110047cf6975d3cbf5d2c71214c0`:
**846 package entries, 844 emitted files**. The complete tarball is installed
offline with scripts/audit/funding disabled. Runtime dependencies remain empty.

Consumers use **bare root and `virtual-bash/commands/which` imports**. Frozen R01
checks actual resolution inside that installation, correct export identity and
absence of a source tree. The moved run makes the first installation and source
path unavailable, uses fresh file-hash admission, and loads no source module.
TypeScript `--listFiles` output records the installed declarations. Byte/mode and
file-entry-set checks cover source, emitted package, consumers and development
tools before/after; mutated control packages are separate copies.

## Observed public semantics

- Root/subpath expose identical `createWhichCommand`, `createWhichCommands`,
  `whichCommands`, and compatible `WhichCommandsOptions` / `WhichLimits` types.
- `AgentCommandsOptions.which?: Omit<WhichCommandsOptions, "replace">` is readonly.
  Typed nested replacement is rejected; untyped nested values cannot override
  the top-level replacement policy. Both default definitions and plugin setup
  produce exactly the frozen76 names plus `which`, with atomic conflict preflight.
- Definitions/plugin limits propagate; invalid limits admit no partial registry.
  Actual output/status, direct aggregate fallback, literal invoke/pipeline/cwd/
  redirect behavior are exercised, not merely command-name presence.
- Followed regular-file stat precedes delegated VFS X_OK. A real readonly wrapper
  with `permissions:false` still permits the supported metadata/access workflow.
  No mode-bit, registry-executable-path or host PATH fallback is substituted.
- Typed misses versus unsupported diagnostics, exact caller/sink identities,
  backpressure, retained chunks and metadata-only operation remain checked.
  Registered host cleanup blocks public settlement and runs once; WHICH itself
  does not acquire borrowed stdin, owned-output or caller-sink disposal authority.
- `getopts` remains a builtin outside the registry; curl/SafeJS remain optional.

## Negative controls

All eight frozen classes are exercised using exact recorded mutations in isolated
copies. Positive installation bytes never change.

| Frozen class | Measured rejection |
| --- | --- |
| N01 remove root WHICH reexport | R01 assertion failure |
| N02 remove public package subpath | Intentional `ERR_PACKAGE_PATH_NOT_EXPORTED` before semantic cases |
| N03 omit aggregate WHICH | R03 exact membership assertion failure |
| N04 name-only successful stub | R02 actual output assertion failure |
| N05 drop aggregate limits | R08 status/output/limit assertion failure |
| N06 nested replacement precedence | R07 assertion failure |
| N07 broaden aggregate type to include replace | TS2344, TS2322, two TS2578 diagnostics only |
| N08 changed/unlisted/live module | Three actual guard rejections before foreign module body |

Thus there are five runtime assertion mutations, one intended export-loader
rejection, one type mutation and three loader violations within the eighth class.
These are not ten semantic mutant cases. No setup failure or surviving mutation
occurred in this execution. The author's original assembly/discovery failures
remain in its separate evidence; they are not erased or converted into passes.

The module's original25/26 source/moved results and separately approved two-token
B18 overlay1/1 remain historical. **No module26 or native WHICH replay** was done.
FreeBSD manual/source authority is not upgraded to provisioned binary proof.
The independent Stage2 review `7ca45f2d` is a separate synthetic input and is not
silently composed into this public77 candidate.

## Cleanup, limits and reproduction

`REVIEW.json` supplies exact source, executable, tool, package, fixture and capture
hashes. `actual-01.json.gz.base64` preserves source/package archives, exact harness
and frozen fixture bytes, full output/type diagnostics, real load paths/hashes,
mutation diffs, child PIDs/statuses and post-inventories. No AGENTS snapshots,
private-engine bytes, new runtime dependencies or services are included.

Every direct child exits naturally and is checked absent with ESRCH. No timeout,
signal, recovery abort or retry was used to obtain a pass. Every task-owned
scratch root is removed; final process inspection finds no command referring to
that exact root. No unrelated native scratch, root config, production source,
private checkout or author fixture was modified. This is a file/module boundary
and cooperative-cleanup review, not a universal transient-write, worker-thread,
host-callback or arbitrary grandchild-preemption guarantee.

Hash/data-only checks:

```sh
node tests/integration/which-public-independent-20260828/verify.mjs
node tests/integration/which-public-independent-20260828/review-284/verify.mjs
```

Fresh bounded replay with the same tools and unused output name:

```sh
node tests/integration/which-public-independent-20260828/review-284/run.mjs actual-replay
```

The runner cannot overwrite existing captures. It never rewrites the frozen
cohort, old counts, source inputs or acceptance seal.
