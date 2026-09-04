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

- First implementation wave: cmp, yes, shuf and virtual devices in disjoint leaf
  directories. Root is qualifying native oracles and the opt-in delivery boundary.
- No tool is yet accepted or committed.
- Default-build isolation now has a failing-then-passing test and matching literal
  exclusions in tsconfig.build.json and package-lint metadata. This preparatory
  boundary does not admit any implementation or change default command inventories.
- Build/input tests: 219 passed after correcting the required metadata mirror;
  the portable browser bundle baseline has five passing tests.
- Independent yes integration checks passed explicit registration and a VFS script
  workflow, but exposed an option-parsing mismatch in the first GNU reference
  binary. That mismatch is unresolved pending reference-build requalification,
  not evidence permitting an arbitrary product change.

## Native oracle preparation

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
and configure/default-make sequence is running in coreutils-9.7-clean. Preserve
the first binaries and observations; version output alone did not qualify them.

Baseline aggregate check: 36 tests passed using
`node --import tsx --test packages/safe-bash/tests/plugins/agent-commands.test.ts`.
The 79-command default remains unchanged at this baseline; repeat after integration.
