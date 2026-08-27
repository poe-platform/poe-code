# Independent public-built-consumer preparation

**PREPARATION ONLY. No product execution, isolated build, current kernel replay,
global/build/benchmark typecheck or acceptance has run.** ROOT must explicitly
resume this verifier after the committed source READY and hidden-review gate.
The source author must not read these fixtures/native expectations before first
READY. This verifier has not read hidden holdouts or future author cases.

## Frozen bounded controls

Ten native-backed recipes and two separate host-contract controls are frozen.
The native family covers startup Bash/sh `-e`, runtime `set -e`, startup/runtime
`+e`, conditional function/source behavior, eval, pipelines with/without pipefail,
and child option isolation. The public plugin supplies literal invocation
arguments; host rows test an actual shared command-limit dispatch witness and
cancellation reason identity with observed late rejection. These host controls
are custom public integration contracts, not additional native-parity rows.

Both complete native profiles ran once:20 case captures, two role controls and
two version captures. All24 child groups are absent, without timeout/overflow.
Nine of ten tuples agree across profiles. The conditional-source recipe is a
real historical divergence: GNU5.3 continues the tested source and returns0;
Bash3.2 stops at the source failure and returns1. Exact stdout, stderr, effects
and seeded0644 modes are retained separately, not reconciled by choosing a
different oracle for that row. This is **not a product score**.

Actual native binaries:
- GNU5.3.0(1)-release:
  `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA256
  `8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
- Historical3.2.57(1)-release: `/bin/bash`, SHA256
  `35536aea9733aa345b61134a98d00232380898e55b2ea2a07c497011f7dfc7a3`.

Each case has a canonical isolated temporary cwd, scrubbed C locale/UTC/HOME,
and PATH containing only fixture bash/sh symlinks to the selected binary plus
`/bin/cat`. Controls prove the actual nested bash/sh versions and sh POSIX mode.
OS argv0 is the requested bash/sh role; shell `$0`, exact `-c` source and literal
arguments are separately recorded. Native `--noprofile --norc` are startup-file
isolation flags, not unsupported product arguments. No role function prelude
changes the tested source. The native temp cwd corresponds to VFS `/consumer`,
but no output normalization is performed. Native-only bin links are role
infrastructure excluded from relative effects; fixture bytes/modes remain exact.

The consumer-specific shebang assertion is **deferred pending explicit ROOT
design**. No `env -S` assumption, portable-single-argument claim, or modification
to existing `env-single-kernel-argument` is made. That original immutable row
belongs in the later final kernel replay and retains its actual Darwin facts.

## Inspected public API and genuine built resolution

The package is still `virtual-bash`, private0.0.0, ESM. Its actual manifest
exports root `./dist/index.js` and `virtual-bash/contracts` through
`./dist/contracts/index.js`; build is `tsc -p tsconfig.build.json`. No dependency,
name, export, script or manifest edit is needed or authorized.

Inspection confirms root re-exports actual `Shell`, `MemoryFileSystem`,
`agentCommands`, `ShellLimitError` and `FsError`; the contracts subpath also
exports `FsError`. The prepared consumer imports these **by bare public package
names**, installs real `agentCommands()` plus an injected public plugin through
`Shell.use`, and invokes via the actual command context. These statements are
source/manifest inspection, **not yet built-package execution proof**.

After ROOT resumes, `build-ready.mjs` requires an explicit authorization flag,
a40-character committed revision, READY text containing that revision and the
relinquished lease, and matching runtime/parser SHA256 values. It then:
1. Uses `git archive REV package.json tsconfig.json tsconfig.build.json src` into
   isolated temporary storage and verifies each file against its committed blob.
   Manifest/exports must match this preparation; no live/uncommitted overlay is
   allowed. Missing committed shared imports must produce a retained build
   failure for ROOT, not an improvised source copy.
2. Uses the existing TypeScript development toolchain with a **build-only**
   node_modules symlink, records toolchain and actual compiler-input hashes,
   and runs the unchanged build configuration in the archive. No install occurs.
3. Removes that development symlink before the consumer runs. A separate
   consumer directory resolves `node_modules/virtual-bash` to the archived
   package with its unchanged manifest, not to the live repository or fake name.
4. Runs plain Node, **without tsx**. `import.meta.resolve` must resolve both
   public entry URLs into the snapshot's emitted dist JS. A load hook rejects
   product file imports outside that emitted tree or with non-JS suffixes and
   records every actually loaded file hash against the emitted manifest.
5. Runs the unchanged12 consumer rows once, preserving raw outcomes and BOTH
   whole native comparisons. It checks unchanged emitted/source/config files,
   captures literal middleware argv, forbids product child-process calls and
   disabled fetch, and cleans owned process groups/temp storage. This is not a
   claim that trusted host JavaScript itself is sandboxed.

The package remains private; this proves local public-export resolution of a
committed built snapshot, **not an npm-registry installation/publication claim**.
The archive may contain committed source for build provenance, but the actual
consumer loader is forbidden from using it. A correct export name alone is not
treated as proof of emitted-module behavior.

## Resumption and remaining gates

The prepared runner has had syntax checks only; its build and public consumer
behavior remain **UNRUN**. There is no inferred green score or claim that the
future READY archive compiles. Failures must be retained and routed without
changing frozen expectations, injecting dependencies or repairing source.

After explicit ROOT resumption, a fresh artifact name is required:

```sh
node tests/shell-stress/errexit-consumer/build-ready.mjs --root-authorized-ready READY_FILE FULL_COMMIT new-built-consumer.json
```

ROOT separately authorizes the additive kernel-reconciliation replay at the
final committed hash: unchanged36+10, CORRECTED72/raw57 and both entire36+57
native profiles once, plus guarded global/build/benchmark noEmit then—not now.
Previous f1/3e2b880 results remain30/36 GNU,29/36 historical,host10/10,
CORRECTED72/72 and raw52/57+50/57. They are historical, not future predictions.
The different hidden verifier owns its independent compound controls; none are
duplicated or read here. Accepted accounting, old9, CUSTOM firstread5, separate
seven, creation-mask policy and other suites remain untouched and unrerun.

Official semantic reference inspected: GNU Bash5.3 distribution
`doc/bashref.texi`, *The Set Builtin*, lines5929–5963, covering `-e` exceptions
and function/compound ignored contexts. The corresponding official GNU manual
page was requested; captured native profiles, not assumed historical equivalence,
determine these frozen expectations. No ERR trap, inherit_errexit, umask or
lifecycle API is proposed. Freeze preparation, publish the non-fixture handoff,
then STOP without waiting for source READY.
