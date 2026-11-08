# Proposed owned GNU Bash reference build — NOT authorized execution

Target: verified upstream GNU Bash 5.3 source plus all official patches 001–015,
without disabling syntax, builtins, job control, arrays, substitutions, Readline
or other upstream core features to match tests. No product runtime dependency,
global install, host package manager, network, native differential cases or
private source is part of this proposal. Source/configuration identity and an
actual executed version result remain separate proof roles.

## Admission conditions before any build

1. Reauthenticate signature/source inventories and all exact selected tools.
   Seal realpath/mode/size/hash/load-command and transitive dependency closure
   for CLT clang, ld, ar, ranlib/libtool, make, bootstrap `/bin/sh` and utilities.
   Resolve the observed linker/ranlib `@rpath` dependencies from actual load
   commands; do not treat a plausible library filename as admitted resolution.
2. Authenticate the finite SDK header/library/tool-resource projection actually
   granted to compilation. Current MacOSX26.5.sdk directory metadata is not that
   proof. Include clang builtin headers and system/cache bindings; deny implicit
   Homebrew or user include/library/package-config search paths.
3. Freeze a complete bootstrap tool alias table. The current table is partial:
   `/usr/bin/expr` is absent, so the actual expr location needs metadata admission;
   configure also references utilities such as uname, head, tail, cut, cmp and
   install which were not all admitted in this source-only task. Fail closed on
   an unlisted command, rather than widen PATH or install missing software.
4. Faraday must supply an independently demonstrated applicable process/fence
   route, or ROOT must explicitly select a different build-execution authority.
   Do not assume provider-v1 currently confines descendants or filesystem access.
   A synthetic wrapper or metadata-only inspection cannot establish that claim.
5. Preseal a self-contained capture-first supervisor, all executable aliases,
   generated-helper authority, descendant accounting/retirement observations,
   complete source copy recipe, source-mode restoration, and terminal criteria.
   Required unknown descendant/retirement is a STOP, not an ignored diagnostic.

## Exact proposed source and layout

Create one exclusive owned `<B>` under `/tmp/safe-bash-reference-build-...` with
`source`, `build`, `home`, `tmp`, `bin`, `out` and capture directories. Copy source
as regular files only from the authenticated final inventory, then recheck full
membership/bytes and preserve COPYING/GPL notices. Restore only original owner
executable bits for originally executable source scripts if needed by upstream
recipes; record that explicit mode projection before execution. Do not execute
anything in the current 0600 retained staging tree or alter that tree.

`<B>/bin` contains only sealed aliases to admitted host tools, no wrapper invoking
ambient PATH. Use bundled upstream Readline and default configure features.
Build the `bash` target only: this avoids documentation/install targets without
silently removing shell semantics. No `make install`, tests or oracle suite here.

## Fresh environment and commands

Construct the environment from an empty map. Exact values are sealed after `<B>`
exists: HOME=`<B>/home`, TMPDIR=`<B>/tmp`, PATH=`<B>/bin`, LANG/LC_ALL=`C`, TZ=`UTC`,
TERM=`dumb`, CONFIG_SITE=`/dev/null`, CONFIG_SHELL/SHELL=`/bin/sh`,
DEVELOPER_DIR=`/Library/Developer/CommandLineTools`, SDKROOT=the admitted SDK,
CC/CC_FOR_BUILD=the pinned CLT clang, AR=the pinned CLT ar,
RANLIB=the pinned CLT ranlib, MAKE=the pinned CLT make.
No ENV, BASH_ENV, exported functions, user flags, library-injection variables,
agent credentials, user config, keyring or network environment is inherited.
Compiler resource/sysroot/linker choices must be explicitly pinned in the final
recipe; do not resolve that remaining decision by using ambient driver defaults.

Proposed configure dispatch, cwd `<B>/build`, as literal argv:

```text
/bin/sh <B>/source/configure --prefix=<B>/out --cache-file=/dev/null
```

Proposed build dispatch, same cwd, as literal argv:

```text
<PINNED_CLT_MAKE> -j1 bash
```

These are proposals, not commands run in this task. Configure executes shell
code, config.guess/config.sub and config.status, runs compiler/linker feature
probes, and may execute newly compiled conftest programs. Make may run recursive
make, shell recipe commands, compiler/linker/archiver, and newly compiled
mkbuiltins/mkversion/mksignames/mksyntax. A generated-helper allowlist must bind
the sealed recipe/input graph and newly observed output hash before admission;
it must not mean arbitrary execution of any new file in the work root.
Conditional external localization/terminal dependencies require explicit
admission or refusal, not default-feature suppression to force a successful build.

After the build and cleanup, copy only the authenticated resulting binary to
`<B>/out/bash-5.3.15`, inspect hash/mode/size/load commands, and bind config.log,
config.status, generated config.h/Makefiles and full source/tool receipts. Only
then propose one isolated version observation:

```text
<B>/out/bash-5.3.15 --noprofile --norc --version
```

Expected version/profile must be checked against actual captured output, not
the output filename or source patchlevel. Native 40-case compatibility and
provider/runtime qualification require their own already-coordinated admission.

## Finite next-grant proposal

Request, not permission: one attempt, 45-minute overall wall ceiling, 16,384 ALL
owned starts including configure/compiler/helper descendants, peak 16 processes,
128 MiB combined capture, 2 GiB logical working storage. This conservative finite
process ceiling is not a forecast/benchmark: configure's shell/probe descendants
are not represented by one top-level configure process. `make -j1` alone does
not establish peak 1 or complete descendant observation.

Phase maxima clamped to the same remaining overall budget: admission 120 s,
configure 1,200 s, make 900 s, binary metadata/version 60 s, publication and
retirement 300 s (total 2,580 s within 2,700 s). Individual ordinary compiler or
utility body 120 s; version body 3 s / 64 KiB per stream. One stream <=8 MiB,
combined <=128 MiB. Reserve teardown inside these limits, no silent renewals,
retry, dependency download, feature-disable rebuild or alternate compiler.

This proposed ceiling needs ROOT approval and an actual observable enforcement
implementation; no new allowance follows from this document. Safety, capture,
integrity, unlisted executable or unknown retirement stops without fallback.
