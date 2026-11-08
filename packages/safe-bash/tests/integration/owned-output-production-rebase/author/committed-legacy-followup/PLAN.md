# Bounded committed-candidate author replay

August 27, 2026. New evidence only; no production source, existing test assertion,
prior capture, golden or oracle edits. ROOT's fixed candidate remains
`eba049535d154f4e028f57ffd8efd7622b2239ca`, tree
`62d75ef09e89d4d3b6afc032c518d2846dcd03b7`.

Recover the four exact commands from accepted evidence commit
`f27b7b595c529d26161a21cf86d2a86fc0d2cee3`: legacy-core-final-02 (27 entrypoints,
505 tests), legacy-state-final (6 entrypoints, 203 tests), focused-types-final-02,
and source-types-final-02. No new assertions or command arguments. The existing
42 committed-source runtime checks are not repeated or added to this denominator.

Extract one controlled Git archive containing all committed src entries,
package.json/package-lock.json/tsconfig.json/tsconfig.build.json, complete
tests/contracts, tests/shell, tests/commands/network and
tests/commands/network-zero-caps-review directories, commands/helpers.ts, the two
selected command test files, and the four selected author TypeScript files.
Complete helper directories intentionally include inert unselected files; no
extra test discovery or execution is authorized. Only the 33 selected legacy
entrypoints are passed to node:test. Native-reference JSON and capture-driver
helpers remain committed, immutable inputs; capture modes are not invoked.

Use a unique regular TMP snapshot, not a worktree, symlinked source tree, live
overlay, package build, pack or install. Copy only the installed lock-matched
TypeScript/tsx/esbuild/current-platform binary/Node types/undici-types/fsevents
tool packages as regular files. Pin existing Node, /bin/bash and /usr/bin/curl
executables separately. No ambient NODE_OPTIONS/NODE_PATH/proxy credentials;
isolated HOME/TMP and disabled tsx cache. Original native curl helper explicitly
uses loopback, -q and --noproxy '*'; no service/dependency network access is added.
This is not a syscall-level external-network deny policy or OS-library closure.

Hash complete source/test/config/tool trees before and after each command, with
file bytes, modes, symlink/special-node rejection and directory entry inventories
that detect additions. Exclude only explicitly separate per-run scratch/output
directories, never source/test/config/tool descendants. Monitor selected external
tool files and installed tool-package trees too. Source and patch identities must
match ROOT's fixed hashes before execution; foreign live HTML/getopts state is
not an input or admission veto.

Each command has a 300-second outer supervisor deadline. A failure, changed input,
unexpected skip/count, type error or missing prerequisite stops subsequent
commands; preserve and report it without source/fixture repair. Record actual
duration, exit, counts, tool paths and integrity scope. This is AUTHOR verification,
not a release gate, promotion, private-runtime audit or independent review.

Preparation-only read errors before this plan: a zsh loop variable named `path`
temporarily shadowed that process's PATH; a guessed helper filename and an
uninstalled, unneeded historical tool-package name were read unsuccessfully.
Corrected discovery used actual committed imports/package dependencies. No test,
typecheck, installation, source edit or candidate failure occurred in those reads.
