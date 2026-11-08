# WHICH77 public author handoff

This is author evidence, not independent public acceptance or a whole gate.
Root wiring commit `ee1f69e721e350fcc77d634b92e5c9f13f61dedb` changes only root
index, aggregate index, package exports and root README. The accepted WHICH
implementation is unchanged at `0902f3c541c8e9a79771f55cb5c9b78c6b6eb09b`.

## Exact separate candidate

- Product candidate: `284857d7aa9b0ee0df2b6fdd1a71f41115d7b909`.
- Tree: `f4eaa4c268ff7f43e1c9eac7b469faf6a3846edb`.
- Sole parent: final76 amendment `2ffcb23d6029250c48950030120ed0adad2e5769`.
- Full tarball SHA256, reproduced by both author builds:
  `49191d098e1e9f5b946f24dd898377144062110047cf6975d3cbf5d2c71214c0`.
- Exactly15 changed paths versus76: four public wiring/docs files plus the11
  accepted module files. No module source, shell/helper373/578, runtimeStage2,
  TEMP expr or unrelated moving source enters this candidate.

`PRE-WIRING.json` records clean root Git absence and the independent
`02ccea66d1e7983056c0ed114f8842fbd7ec3255` freeze before wiring. `CANDIDATE.json`
contains raw commit bytes and each selected source revision/blob/hash.
`reconstruct.mjs` rebuilds both synthetic76 and77 commits twice in fresh object
databases, including a space path, from reachable44/fd3/ee1/0902. It verifies all
selected blob bodies; `write-tree --missing-ok` is only for unchanged bodies
omitted from the explicitly minimal tree skeleton. The complete package is
actually built from the full authenticated source selection, not that skeleton.
No refs are created and no loose candidate object is required for reconstruction.

## API and authority

Root `virtual-bash` and explicit `virtual-bash/commands/which` export:

- `createWhichCommand(options?: WhichCommandsOptions): CommandDefinition`.
- `createWhichCommands(options?: WhichCommandsOptions): readonly CommandDefinition[]`.
- `whichCommands(options?: WhichCommandsOptions): VirtualShellPlugin`.
- Types `WhichCommandsOptions` and `WhichLimits`.

`AgentCommandsOptions.which?: Omit<WhichCommandsOptions, "replace">` forwards
only `limits`. Deliberate untyped nested replacement cannot override top-level
`replace`; direct factories retain their own replacement policy. The literal
default registry is the frozen76 list plus `which`, exactly77 unique names.
Curl/SafeJS stay optional; getopts is a builtin outside that list.

Followed regular-file stat precedes delegated VFS X_OK; readonly wrappers work.
There is no host PATH/file execution, content read, mode-bit authority, registry
fallback or new owned-output acquisition. Which awaits provider work and writes
with the invocation signal; it cannot preempt opaque providers. This is not
`type -aP`, full native parity, provider atomicity or a future-execution guarantee.

## Actual author checks

The independent frozen test bodies are copied unchanged and executed by the
author; this does not turn them into an independent verdict. Installed and
physically moved complete packages run all18 runtime families on Node22.22.2 and
24.11.1: four18/18 executions, zero failures/skips/TODOs/cancellations. Four strict
type families pass in each layout. Their original negative type assertions are
unchanged. This covers all22 declared families, not a new broader denominator.

The actual package has846 files/844 emitted files.265 selected source/build
inputs and complete package/dependency/source inventories are recorded. Each
public context authenticates207 actual main-thread loads, including root/WHICH
and the unchanged fixture, under a package/consumer read fence. Actual binaries
and hashes are recorded; no source fallback or private engine is used.

Two source-read denial controls and five isolated missing-root/runtime/export/
declaration/nested-replace controls produce their exact expected nonzero exits.
Both strict type-resolution probes select declarations in that same installed
package. Source/package/consumer inventories reject persistent additions,
removals and changes; the final sweeps pass. All24 supervised commands return
naturally. This is not a universal worker-thread import or transient-write audit.

The first author launch built/packed/installed successfully but Node22 `--test`
discovery could not see the fenced test path: zero runtime cases executed.
The corrected harness uses the established direct node:test consumer dispatch
with explicit TAP, retaining the filesystem fence and dropping unnecessary
child-process permission. The original launch/source remains in raw evidence.
Earlier assembly path-guard and minimal-object reconstruction setup errors were
author harness errors before consumer acceptance; they did not trigger product
edits or change assertions. Original module25/26 and separate B18 overlay1/1
results remain historical; they were not rescored here.

No canonical count fixtures or76 driver packet were rewritten for77. The76
remaining line32/suffix issue and the subsequently requested versioned driver
policy changes remain separate. Public77 requires Poincare's different review.
