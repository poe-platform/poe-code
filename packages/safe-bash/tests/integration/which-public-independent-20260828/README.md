# Independent public WHICH / 77-command freeze

August28,2026. **Pre-wiring fixture, not public acceptance.** Root has authorized
this independent freeze before Curie's public wiring. The future public77
candidate is deliberately **unbound** until root supplies its immutable commit.
The existing fixed76 gate/candidate remains separate and is not modified or
rescored. No current missing root/subpath import is called a module defect.

## Approved public contract

- Root `virtual-bash` and `virtual-bash/commands/which` expose
  createWhichCommand, createWhichCommands, whichCommands and the two types
  WhichCommandsOptions / WhichLimits through actual installed declarations/JS.
- AgentCommandsOptions gains readonly optional
  `which?: Omit<WhichCommandsOptions, 'replace'>`. Family limits reach the actual
  command in both definitions and plugin paths. Top-level replace governs the
  whole registry. Deliberate untyped nested replace values cannot override it;
  strict TypeScript rejects that nested field.
- Default definitions and fresh aggregate registration contain **exactly77
  unique names**: the preserved canonical76 list plus which. The list is copied
  from the source fixture with a recorded hash, not inferred from a bare count or
  claimed as a new76 execution. Getopts remains a shell builtin outside that
  registry; curl and SafeJS remain optional and are not auto-enabled.
- Installed public consumers retain stat-first delegated X_OK, read-only wrapper
  support, no mode/host/registry fallback, exact error identities, metadata-only
  lookup and normal shell output/cleanup behavior. This is not native execution
  authorization, provider atomicity, an RSS bound or opaque-work preemption.

## Families and timing

The freeze contains **22 distinct families: R01–R18 runtime and T01–T04 types**.
`cohort.mjs` uses only bare public imports, never internal/dist/source imports as
a substitute. `types.json` contains four strict .mts consumers for actual package
exports. `cases.json` records exact expected77 membership and every case binding.
`negative-plan.json` declares eight targeted public-integration weakening classes.
No public runtime, type compilation or negative control is executed at this seal.
Syntax/schema/hash checks alone do not constitute any of those passes.

This freeze follows independent module review ea7e6cf3 and selected B18
qualification c40bc5fa. Original module25/26 source/moved outcomes remain intact;
only the root-approved two-token B18 overlay was replayed1/1 per layout. The
public fixture does not rerun that26-group cohort or redefine it as all green.
The public cases were designed **after** module implementation/review, but
**before** public wiring. Do not describe them as pre-module holdouts.

R10 uses real Memory and ReadOnly(Memory), with a metadata-only trace facade;
R11 injects public FsError access failures, not an actual S3/WebDAV service.
R17 enrolls cleanup through host middleware before dispatch. It does **not** make
which acquire resources or install fake cleanup: R18 explicitly rejects such
borrowed-input/output acquisition. Cleanup/write gates release in finally, and
the test's Promise.race detects premature settlement only; it adds no product
cancellation race/API. Native/provider atime effects are not forbidden stat-field
immutability. No stage2 invocation signal field or timeout command is assumed.

## Required future installed/moved execution protocol

This is a concrete admission contract for the later root-bound review, not a
claim that a public77 package already exists:

1. Require root's explicit public77 Git commit. Extract its product, package and
   build inputs from Git; authenticate them before/after, never overlay live
   source. Extract this committed fixture separately and verify its hashes.
2. Build the actual complete package with isolated copied development tooling.
   Pack the real manifest/files allowlist with scripts disabled. Retain the
   tarball hash and actual package JS/declaration inventory. No new product
   runtime dependency, network-enabled install or global/home configuration.
3. Install that local archive into an empty task-owned consumer using offline,
   script-disabled installation. Source is not installed or linked. Admit actual
   root and subpath URLs with a loader checking every resolved executable module
   against the installed manifest. Reject live checkout, changed/unlisted files,
   external product modules and arbitrary source/deep-import fallbacks.
4. Copy the frozen cohort/cases to the consumer, set PUBLIC_WHICH_LAYOUT to
   installed and PUBLIC_WHICH_PACKAGE_ROOT to that authenticated package root,
   then run only this18-runtime-case cohort. Compile all four frozen .mts inputs
   against the same installed root/subpath exports with the recorded strict flags.
   Capture actual type closure; installed declarations must satisfy it, not live
   src or an unbundled copied declaration shortcut.
5. Relocate the complete installed consumer/package to a different task-owned
   path and remove or make the first installation unavailable. Keep no source
   tree. With fresh bound manifests and PUBLIC_WHICH_LAYOUT=moved, repeat those
   same18 runtime and four type cases. Preserve both layouts' original failures.
6. Run a bounded selection of the eight declared negative controls in separate
   task-owned copies, never mutate the qualified positive package or root files.
   Distinguish intended import/type rejection from setup accidents; preserve all
   initial failure bytes, exact mutation diffs and actual loaded-module hashes.
7. Close all registered cooperative cleanup and pending test gates, dispose
   shells, stop/wait for every owned child, then remove only owned scratch data.
   Report before/after source/package entry sets as well as hashes, tool versions,
   source/candidate/tarball/fixture hashes, raw statuses and any remaining gaps.

The future execution harness may implement this protocol after root binding;
it must not change these frozen assertions merely to fit its candidate. Current
preflight checks only confirm no public.which field/export exists at freeze time
and verify this data/code, without attempting unavailable public imports.

No FreeBSD binary is provisioned, no Darwin which native run is added, and the
pinned FreeBSD manual/source authority is not upgraded to binary qualification.
No new full gate, comparison cohort, root export, default registry or package
manifest edit occurs in this owned test subtree. Stage2 freezes remain unchanged.

Hash-only verification:

```sh
node tests/integration/which-public-independent-20260828/verify.mjs
```
