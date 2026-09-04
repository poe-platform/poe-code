# Opt-in real-world scripting tools

## Request and delivery constraints

The September 4, 2026 request is to add all missing items identified in the
scripting inventory, subject them to native-tool scrutiny, keep them out of the
default package, and commit each tool separately. Work remains on main. There
is no request to push or release. Existing unrelated edits are not part of this
work.

New command families must remain explicit opt-ins: no registration in
`agentCommands`, `standardCommands`, or `browserCommands`, no root-barrel export,
and no accidental inclusion in the default bundled runtime. Shell extensions
must also require explicit opt-in rather than change default shell behavior.
Existing available commands, including date and the opt-in curl implementation,
are retained rather than duplicated. Browser-wide expansion is not authorized by
this request to keep additions out of the default package.

## Required scope

- Separate tools: cmp, shuf, dd, truncate, yes, install.
- Explicit virtual devices: /dev/null, /dev/zero, /dev/random, /dev/urandom.
- Qualify and expose the existing experimental yq implementation as an opt-in;
  presence of source code alone is not delivery.
- Shell extensions: trap (including EXIT cleanup), mapfile/readarray, fuller
  array support, read -a/-u/-t, background execution and wait.
- Preserve the existing date, sleep, timeout, mktemp, seq, byte tools, text tools,
  source/getopts/functions, heredoc, substitution and pipefail behavior.

## Acceptance and evidence

1. Establish a failing test or concrete missing-behavior reproduction before
   each implementation change. Unit fixtures use the VFS or memfs, not disk.
2. Define the real-tool dialect from primary documentation and executable
   native-oracle versions. GNU and BSD differences must be explicit, not mixed
   opportunistically. Match bytes, exit statuses, diagnostics, filesystem effects,
   argument grammar, and composition. Unknown or unsupported cases are not passes.
3. Validate retained binary arguments/chunks, cancellation, stream closure,
   backpressure and allocation/output limits. Infinite producers must stop when
   their consumers stop. No product native-process or implicit host-filesystem
   fallback is permitted.
4. An independent worker reviews and tests every implementation before root
   commits it. Root owns shared contracts, public/build wiring, test membership,
   this plan, integration and Git operations. Leaf owners have disjoint paths.
5. Keep exact default inventory assertions unchanged. Register every new canonical
   test literally in the maintained integration-input assertions. Use maintained
   scoped checks, then guarded build/typecheck and broader checks where shared
   interfaces change. Visually inspect output for user-visible command changes.
6. Commit each tool separately with relevant tests, semantics/evidence and plan
   updates. Never commit unrelated changes or bypass hooks. Report local commits
   separately from remote delivery and releases, neither of which is requested.
7. Do not declare the objective complete until every scope item has current
   source, behavioral, integration and delivery evidence. A partial wave remains
   partial even when its own tests pass.

## Initial evidence

- The source-loaded agent aggregate contains 79 commands; browser aggregate 28.
- `date -u -d @0 +%FT%TZ` succeeds with `1970-01-01T00:00:00Z`.
- cmp/shuf/dd/truncate/yes/install are absent from the aggregate and command source.
- All four device paths return ENOENT on the fresh memory filesystem.
- yq exists under src/commands/yq, is absent from default registries and exports,
  and is explicitly excluded in tsconfig.build.json.
- trap/mapfile/readarray/wait are absent from builtin registration; the parser
  rejects background `&`. read rejects -a/-u/-t; array subscripts are restricted.

## Work ledger

- Root reproduced mixed source/compiled runtime failures: binary argument
  ownership rejected and named output bypassed the public host's output budget.
  Runtime-bound command definitions now declare their contract-module identity.
  Independent review then reproduced mutable-identity and supplied-registry
  bypasses; regression tests failed before their fixes. Reviewed identity tests
  pass 9/9, and rebuilt public-host tests pass 6/6, including binary output,
  shared named-output accounting/cleanup, foreign empty/populated registries,
  replacement safety, and actual declaration compatibility. This guards accidental
  runtime mixing, not malicious host JavaScript or prototype tampering.
- An explicit local `build:optional` compiles a selected entry into the public
  host's own dist module tree. It does not add npm exports or default registrations.
  After successful compilation, workspace and root pack dry runs respectively
  contain 1,050 and 4,641 files with zero optional implementation leaks. Both
  manifests explicitly exclude optional artifacts even if locally compiled.
  These are live-worktree integration observations, not a frozen release gate.
- Current root reruns of the independently reviewed leaves: shuf 323/323 and
  truncate 348/348, zero skips, using the clean GNU 9.7 binaries and explicit
  digests. Their runtime-affinity tags are included in these reruns.
- The yq audit confirmed that the existing implementation is a restricted YAML
  plus jq subset, not qualified Mike Farah compatibility. New work begins with
  four reproduced correctness defects: flow comments, symlink-sensitive paths,
  raw-byte filename aliases, and cancellation starvation on empty input chunks.
  The pinned official v4.53.3 Darwin arm64 binary is authenticated by SHA-256
  `877de31753a4dd2401aa048937aa9a7fc4d5f6ce858cf31508c5802954297213`
  and its version was executed. CLI/default/operator parity remains open.

- Local commits: `d18b2e0ed` establishes build isolation; `27beeaf50` adds yes;
  `209190556` preserves character-device metadata through filesystem consumers;
  `75a013fd4` adds preferred-I/O metadata and corrects device-number forwarding;
  `71e3f5f74` isolates dd/install leaves; `633b73d50` adds opt-in virtual devices;
  `533c75ab1` adds the reviewed cmp command; `98a1cbb83` keeps explicit optional
  builds in the host runtime's module tree and rejects accidental runtime mixing;
  `e0ac05530` adds the reviewed shuf command; `005b812cb` adds the reviewed
  truncate command; `ce26db16e` exports optional configuration types.
  None has been pushed or released, and neither action is requested.
- Shuf is ready for its separate local tool commit: 323 native/profile tests and
  eight compiled optional/public-host tests pass, source/test/consumer types pass,
  exact canonical test membership is declared, and the actual output screenshot
  was inspected. Public-host binary argv and named-file output budget failures
  were explicitly retested after coherent compilation. Default exports and
  registry membership remain unchanged.
- Truncate is ready for its separate local tool commit: 348 native/profile tests
  and ten compiled optional/public-host tests pass; source/test/consumer types
  pass. Canonical membership lists all four new tests. A real public-filesystem
  consumer verifies the 65,536-byte memory I/O-block policy for `-o`; raw argument
  diagnostics and invalid-byte filename non-aliasing also pass in the compiled
  host. The actual truncate output/help screenshot was inspected. Unsupported
  provider capabilities remain explicit rather than synthetic native behavior.
- Post-commit checks: the maintained selected virtual-bash build succeeds, all
  36 default inventory tests pass with the original 79 commands, and the maintained
  contract route passes 249 tests. A missing optional options-type export was
  reproduced by the actual declaration-consumer test (nine pass, one fail);
  exporting the yes/cmp options and device interface restores ten passes. These
  types remain part of the explicit local optional entry only.
- The compiled public-host suite now passes eleven tests, including an actual
  VFS `.sh` file under `set -e` combining existing date/byte tools with mounted
  urandom, shuf selection, copying/cmp, truncate zero-extension, and yes with a
  short consumer. It checks exact output, token alphabet/length, copied prefix,
  zero-filled extension, and sampled membership. Strict consumer types pass.
  The first manual probe supplied an array instead of the documented mount map;
  that harness argument error was corrected, not treated as a product defect.
- Guarded root ESLint's fifth run completes with exit 0. The prior fourth run
  reported three unsafe-finally findings in ongoing install/trap work; authors
  repaired them without suppression. Subsequent in-flight source work still
  requires its own final checks rather than inheriting this snapshot's result.
- Root confirms yq phase-1 old/new tests pass 111/111 with the authenticated
  reference; independent review is pending. Trap review instead reproduces two
  failures (144/146) in BASH_COMMAND reporting and independently identifies mixed
  source/compiled extension byte ownership. Those are open author fixes.

- First implementation wave: cmp, yes, shuf and virtual devices in disjoint leaf
  directories. Root is qualifying native oracles and the opt-in delivery boundary.
- The yes leaf is verified for its documented GNU 9.7 C-locale profile: 135 tests
  pass with zero skips, including independent Shell comparisons and VFS scripting.
  Its source/test project typechecks, and actual output passed visual inspection.
  The explicit version-identity and resource/host limits remain documented.
  Commit it separately; all other tool and shell-extension acceptance is pending.
- Default-build isolation now has a failing-then-passing test and matching literal
  exclusions in tsconfig.build.json and package-lint metadata. This preparatory
  boundary does not admit any implementation or change default command inventories.
- Build/input tests: 219 passed after correcting the required metadata mirror;
  the portable browser bundle baseline has five passing tests.
- Independent yes integration exposed an option-parsing mismatch in the first GNU
  reference binary. A clean reference rebuild resolved it without product parser
  changes. Preserve that failed reference evidence rather than hiding it.
- Shared character metadata support passed 21 focused command tests and 12 root-run
  bridge tests; the author also reports 73 nearby command and 56 bridge regression
  tests. Character nodes remain distinct from ordinary files, including across
  bridge Stats/Dirents. This introduces no default device mount and does not widen
  the real adapter's native special-file admission. The device implementation,
  concurrent output handling and independent copy review remain separate work.
- The maintained selected virtual-bash build completed both dependency tasks.
  A default virtual-bash npm pack dry run listed 1,046 files and no optional
  cmp/dd/install/shuf/truncate/yes/yq/device implementation files.
- Follow-up root device run: 79 tests pass with no skips, including independent
  descriptor and copy review. This is scoped behavior evidence, not a claim that
  Darwin urandom writes match the explicitly different portable device profile.
  The named independentWriteStreams contract is integrated, the device test
  project typechecks, and actual command output passed visual inspection. The
  selected default build passes; its pack dry run lists 1,046 files and zero
  optional implementation leaks. Final device rerun: 79 pass, zero skips.
- Preferred-I/O metadata has 40 passing focused tests and a successful selected
  safe-fs build. Independent root review then reproduced lost rdevMajor/rdevMinor
  fields through readonly, mount and overlay snapshots in three failing tests.
  The correction preserves known zero, partial metadata and absence through each
  wrapper. Root reran all four focused metadata/bridge files: 67 tests pass.
  The selected safe-fs build passes after the correction. Guarded lint completed
  with no metadata findings; its two remaining findings are unsafe-finally throws
  in the concurrently implemented dd leaf, which remain assigned for correction.
- Root cmp rerun: 78 of 79 tests pass; the remaining failure is a native-oracle
  helper signalling its process group after successful close (EPERM), not a
  permitted diagnostic normalization. Root shuf rerun during helper TDD: 292 of
  298 pass, with six new oracle-lifecycle cases still red. Both test projects
  typecheck. Neither tool is accepted or committed by these partial runs.
- Literal exclusions now cover the five dd and four install source files present
  in this wave. Three focused default-boundary/discovery assertions pass. New
  implementation filenames still require explicit exclusion and pack inspection.
- Later shuf review rerun: 316 of 319 pass with zero skips. The helper-lifecycle
  fixes pass; three independently reproduced product defects remain: cleanup
  masking the primary output failure, nonregular-input reservoir selection, and
  raw-byte count diagnostics. The independent reviewer owns their corrections.
- Truncate's current 200 tests and dedicated test-project typecheck pass;
  independent review is pending. Generic shell-extension infrastructure and the
  opt-in trap leaf are now in implementation. The trap implementation has a
  failing-then-passing literal default-build exclusion check; no shell feature
  acceptance or commit is implied by that packaging check.
- Cmp's follow-up independent review corrected exact help output and default
  block selection from canonical first-input metadata, preserving the pinned
  GNU 3.12 selection behavior. The native helper no longer signals an already
  closed process group. Root's final run passes 97 tests with zero skips, and
  the source/test project typechecks. Actual comparison, status and full-help
  output passed visual inspection. Unknown/stdin block metadata, dynamic FIFO
  profiles, non-C locales and truthful version identity remain explicit limits.
  The next complete guarded lint run has no cmp findings; its sole remaining
  finding is a prefer-const binding in the concurrently implemented trap leaf.

## Native yq implementation boundary

The restricted legacy yq entry and its explicitly restricted tests remain
separate from a new Mike Farah v4.53.3 profile. The new native-profile factories
live in `commands/yq/mike.ts`; root will expose them as the normal optional yq
factories only after qualification. No compatibility fallback to the restricted
jq evaluator is authorized. Existing query-core and sealed evidence stay intact.

Root approves the already-installed `yaml` 2.9.0 parser for this optional graph.
The root already depends on YAML; the workspace declares an exact optional peer,
with matching lock metadata, rather than adding a mandatory default dependency.
The library must be loaded only when the native yq operation requires it, not by
default commands, unrelated optional tools, or information-only invocations.
Document/CST nodes preserve metadata; a native-qualified evaluator and emitter
remain required because the library alone does not establish Mike parity.

Eight new source filenames are literally excluded from the normal build and
mirrored package-lint metadata. Their exclusion assertion failed first and now
passes. The proposed implementation includes common native CLI forms, node-based
assignment/tag operations, document-aware eval-all, and VFS in-place updates,
with bounded work and cleanup. It is not yet delivered, publicly exported, or
native-qualified; broader YAML/operator/platform limitations remain open.

## Coherent opt-in runtime boundary

The full maintained root build succeeded after the selected workspace build was
found insufficient to refresh `poe-code/safe-fs`'s bundled public import. The
public memory filesystem now reports its 65,536-byte I/O preference. Preserve
this distinction between a workspace build and the root suffix bundle stages.

Root then reproduced an actual mixed-runtime failure: the compiled public Shell
plus source-loaded shuf returned success and wrote four bytes for
`shuf -e abc -o /file` with `maxOutputBytes: 1`. The same mixture rejected retained
binary arguments as foreign-owned carriers. Source and compiled copies have
different private argument/output-budget bindings; normal ASCII stdout checks
had not exposed the mismatch. No ownership checks or global brands may be weakened
to hide it.

A root-owned guard is in progress: optional command definitions declare their
`commandRuntimeIdentity`; a registry rejects a foreign identity before install
or replacement. The initial three rejection tests failed, then five contract
tests passed; a factory-affinity test then failed before yes/cmp declarations
were added, and all six now pass. Shuf/truncate declarations are also added but
their commits remain pending. This is not yet a rebuilt-public-runtime or
coherent-consumer acceptance result. Independent guard review is assigned.

The intended follow-up is an explicit optional TypeScript build into the same
dist module tree as its host, preserving shared private bindings instead of
bundling another runtime copy. Optional implementation artifacts must remain
excluded from BOTH the root and virtual-bash npm packages even after that build;
the current files lists have not yet been extended for this route. Default build
exclusions/registries stay unchanged. Actual public-host tests must cover binary
arguments, named output limits and lifetime cleanup before this delivery boundary
is accepted. Do not recommend mixing source factories with a compiled host.

## Descriptor work required by dd

The default stream adapter's refusal of named notrunc, nocreat and output seek
does not complete the requested real-world dd scope. Root approved an optional
canonical descriptor API with retained-object identity, explicit access/creation
flags, positioned and sequential byte operations, truncate, synchronization and
noncancelable close. The first phase covers memory and rooted-real adapters,
faithful mount/readonly handling, and explicit refusal rather than descriptor
leakage through quota/overlay/unsupported providers. Unit fixtures remain memfs;
bounded native qualification may use a new controlled descriptor-qa directory
under the existing temporary oracle directory. This does not authorize native
special-file access or a hostile-tree containment claim.

DD integration remains a separate acceptance step. Direct descriptor output must
enroll in the existing shared shell file-output budget and lifetime before any
write. Partial writes must preserve dd's byte/record counts and must not bypass
the budget or silently charge retries as independently completed records. A
counted-write reservation/settlement design should retain conservative charges
when a failed operation's effects are unknown, and return unused admission only
for validated, known partial results. It must preserve existing stdout/stream
accounting, cancellation and cleanup precedence; no fresh per-file allowance or
read/replace pseudo-descriptor is permitted. This design requires failing tests
through actual Shell execution before implementation.

## Native oracle preparation

A separate GNU Bash 5.2.37 oracle is now built for modern shell extensions at
`/tmp/safe-bash-scripting-oracles-20260904/bash-5.2.37/bash`. Its official release
archive has observed SHA-256
`9599b22ecd1d5787ad7d3b7bf0c59f312b3396d1e281175dd1f8a4014da621ff`; the executable
has SHA-256 `f5b331844c67482075aea7883153127668cc67f83a60a7b4362cc8469a9dc77d`.
Clean configure and a full make succeeded. A bounded smoke check verifies indexed
and associative arrays, mapfile, read array/descriptor options, background wait,
and an EXIT handler. This is a deliberately pinned target, not a latest-version
claim. Existing `/bin/bash` 3.2.57 observations remain separate; they do not
qualify modern features absent from that version. Native-comparison suites should
select the new binary explicitly, never silently assume a temporary path exists.

GNU coreutils 9.7 and GNU diffutils 3.12 were built from their official GNU HTTPS
release archives under `/tmp/safe-bash-scripting-oracles-20260904`. They are native
Darwin oracles, not proof of GNU/Linux-specific kernel behavior. These temporary
build artifacts are not product dependencies and are not committed.

Archive SHA-256:

- coreutils-9.7.tar.xz:
  `e8bb26ad0293f9b5a1fc43fb42ba970e312c66ce92c1b0b16713d7500db251bf`
- diffutils-3.12.tar.xz:
  `7c8b7f9fc8609141fdea9cece85249d308624391ff61dedaf528fcb337727dfd`

Observed executable SHA-256:

- yes: `1623e59c022035db7ece95fb10f8c22ab288d21d60f6ad861561b98e10c2b074`
- shuf: `4a98165c9e0f900e4e35891844ee1e3f1d84b19816e1ab8424828e69548126b6`
- dd: `ea4bea9d30c61eb4e166b630ed9ec6eee4c8202a7001d532cfdec3d7338dcf1a`
- truncate: `8a4d0aba94e1826cfafd7c9fe007cf8758286714319d421edc9e8dadf8774f4d`
- install (build name ginstall):
  `2dd570b51e3fade930b1e702d9b2b4daab235a4b69661b4e42c4c8868e1fec38`
- cmp: `5b0ebf8ed3ef54ae96a1a473ec7f25d1b44cbbe9253edacf88f6350fbe5a233a`

The first targeted coreutils build failed because generated uchar.h was absent;
the subsequent full make completed successfully. Executable versions were checked
after compilation. Later independent yes checks exposed mixed GNU/native option
behavior. The suspected cause is objects compiled before generated headers,
retained by the later build with dependency tracking disabled. A fresh extraction
and configure/default-make sequence completed in coreutils-9.7-clean. Preserve
the first binaries and observations; version output alone did not qualify them.

The clean yes binary has SHA-256
`5326dd9df1374a85e4a2a0fddf27d7ae3315ba57a10866c2b27f71cb1878740f`.
It resolves the option-parser mismatches and passes the strict differential suite.
Run that suite with SAFE_BASH_YES_GNU_ORACLE set to the clean src/yes path, then
run `node_modules/.bin/tsc --project packages/safe-bash/tests/commands/yes/tsconfig.json`.
Both checks passed. The actual Shell output image
`/tmp/safe-bash-scripting-oracles-20260904/yes-visual-review.png` was inspected;
this is ad-hoc QA, not a screenshot test or committed artifact.

Baseline aggregate check: 36 tests passed using
`node --import tsx --test packages/safe-bash/tests/plugins/agent-commands.test.ts`.
The 79-command default remains unchanged at this baseline; repeat after integration.
