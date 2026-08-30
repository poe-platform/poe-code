# Proposed next controlled differential panel — NOT execution permission

## Scope and acceptance

40 literal programs in `CASES.json`; no randomized programs, user scripts, native
Git, npm/npx commands, curl requests, private engine, XAN or previous held native43.
Each case gets a fresh VFS and corresponding fresh owned native directory. Compare
exit status, raw stdout/stderr and names/content bytes of owned regular files.
Retain native results, virtual results and mismatch classification separately.
Do not deduce support from command names, rewrite expected bytes or mark refusals
as matches. No all-Bash or whole-product acceptance from this panel.

The case JSON's common fixtures are four literal ordinary files; the harness must
create them byte-exactly and record the pre-state. B23/B25/B28 may create `out`.
No other file changes are expected; a difference is retained, not normalized away.
No clocks, random names in output, external commands, device opens, network paths,
process substitution, background jobs, loadable builtins or user HOME scripts.
Native `exec` in B28 performs descriptor operations only, not another executable.
B38 is an EXIT trap, not an external signal delivery test.

## Native launch admission requiring a new grant

1. Locate and approve an installed GNU5.3 binary, its patch level, file/link and
   dependency closure. Metadata in this packet is insufficient for execution.
   No installation, version substitution or ambient PATH search is authorized.
2. Use an explicit absolute admitted binary with `--noprofile --norc -c`, the
   exact literal program, and fixed argv0 `surface-case`. Version identification
   would itself be an explicitly admitted observation in that future recipe.
3. Supply a freshly constructed environment (env-i semantics, not an ambient
   `/usr/bin/env` subprocess): only `LC_ALL=C`, `LANG=C`, `TZ=UTC`, `HOME=<owned-home>`,
   `PATH=<owned-empty-directory>`; shell-derived PWD is its real owned cwd.
   No BASH_ENV/ENV, exported functions, SHELLOPTS/BASHOPTS, credentials or NODE_OPTIONS.
   Use logical VFS HOME/cwd counterparts; programs do not print absolute paths.
4. Native cases use Bash builtins/control syntax only. Missing command B39 must
   search only the empty owned PATH. Any unexpected exec target is a fatal
   admission failure, not an opportunity to add a host utility.
5. Apply the reviewed OS fence: reads of exact binary/dependency metadata and
   owned fixtures only (system-library metadata exceptions need their own existing
   approval); writes confined to case-owned roots; no private/home/repo inputs,
   instruction filenames/materialization, sockets or network. No arbitrary host
   interpreter access. A new native binary must not inherit an unrelated tool grant.
6. Preseal negative admission controls: changed binary/program/env; outside write;
   resolved symlink escape; unexpected child exec; output overflow; unknown child
   retirement. Use harmless owned sentinels and approved observer routes, not
   attempts on user files. Controls are not part of the40 semantic denominator.

## Virtual counterpart

Use only an authenticated complete source/package selected by ROOT, with a fixed
Node binary and finite loader/dependency closure. A future corrected candidate
must be a new version beside c83f, not an overlay silently attributed to it.
Construct Shell with explicit filesystem/env/cwd and default aggregate, no host
fallback or injected missing builtins. Capture raw bytes before public-text
decoding; if the public API cannot expose them, declare that comparison gap rather
than recovering lost bytes from strings. Dispose and await owned cleanup for every
case. Caller abort/limit/cleanup rejections stay distinct from ordinary shell status.

Compare exact stderr initially. If native argv0/line formatting differs, record
the difference and submit a specific profile decision; no blanket prefix/path
stripping. Validate each native program is meaningful before interpreting a virtual
failure (e.g. GNU-only grammar must not be silently run against platform Bash).

## Proposed future bounds and stop conditions

This is a **separate proposed execution envelope**, not expansion of the current
30-minute/64-child source-only grant: <=10minutes including publication/cleanup,
<=128 ALL descendants including native pipeline/substitution children, peak8,
one case at a time, <=3seconds per case, <=64MiB total capture (<=256KiB per stream
per case), <=128MiB working data. No builds/installs are included; any necessary
package preparation needs a separately declared bound/grant first.

An outer owner records PID birth/group and all launches, retains capture and
reaps only its children. An unknown observer, fence/integrity/capture or cleanup
state stops dependent work with a nonpass result and no automatic retry. A forced
deadline is a retained failure, not a rescued pass. Ordinary byte/status assertions
may aggregate after safe cleanup. Native fork/child-count limits must be enforced
and observed, not inferred from the number of direct spawn calls. The recipe must
refuse to start without a qualified process observer and all exact tool bindings.

## Requested root decisions

- Approve/adjust this40-case panel and select the exact GNU reference executable;
  the local `/bin/bash` metadata alone is not enough.
- Approve a separately presealed runner/controls and finite native fence, not
  implementation changes or broad native43/fullgate activation.
- After results, choose narrow stderr-redirection syntax and/or strict-mode
  implementation scopes with different source/behavior review. Declaration uses
  existing ratification; mapfile still needs final shared-cursor policy binding.
