# Directory-stack design observation freeze

Pre-implementation fixture only: 34 source scripts, 33 requested-profile probes
and one explicitly deferred DIRSTACK/tilde-stack probe. The purpose is to record
native behavior and the missing-feature virtual baseline, not impose guessed
native expectations. All scripts and the execution recipe are sealed before
native scenario execution. No product helper, builtin registration or runtime
change is authorized. The author has read existing cd/state/budget code and GNU
manual sections 6.8/6.8.1 and DIRSTACK, but no new directory-stack native cases
have executed when this freeze is committed.

Target: already available GNU Bash 5.3.0(1)-release, Darwin arm64,
`/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`, SHA-256
`8cecb482de24198c23a736b931cb7e8cee1f94eb0b51abd54bd99f1d73d9673c`.
No native binary installation/build/download, startup files, external commands,
private checkout or system configuration writes. Each invocation has a fresh
task-owned fixture root, literal argv, closed stdin, `--noprofile --norc`, empty
PATH, C locale and an exact environment (no BASH_ENV, ENV, SHELLOPTS, BASHOPTS or
inherited function definitions). D29 uses the Bash `cat` name through a local
function implemented with builtins, so an empty PATH does not introduce a host
utility dependency. The function is present identically in the virtual script.

Fixture: directories a/child, b, c, home/one, home-suffix, with-space spelling
`with space`, ümlaut, -dash, +1; ordinary file `file`; symlink `link -> a`.
All cases start at their fixture root with HOME=root/home, OLDPWD=root.
ROOT=root is explicit. Only exact native fixture-root occurrences normalize to
`/fixture` in comparison output; no diagnostic-prefix, ordering, errno, path,
whitespace, Unicode or status weakening. Raw output bytes remain. A match on
stdout/status is separately named; stderr exact equality is separate, not
implied. A native failure is an observation, not permission to waive a feature.

Virtual baseline: accepted fd1 selected reconstruction from the prior sealed
Stage2 package, not live source/dist. Same scripts and equivalent MemoryFS
fixtures, explicitly aggregate plugin for printf/cat support. No new Shell per
builtin; the harness creates one shell per independent native/virtual case.
DIRSTACK array parsing failure stays a deferred/dependency result. Future
host-invoke, middleware, VFS errors, sink identity and resource controls belong
to the implementation review and are not claimed exercised by native scripts.

Bounds: one direct native process per case, one virtual worker per case,
5-second child timeout, 128-KiB stdout/stderr collection bound; no retries. Each
virtual Shell uses 1-MiB output/source/word limits, 1000 commands/loop iterations,
1000 fields, and an actual 3-second AbortSignal. Scripts contain no external
native processes; Bash may create its own subshell/pipeline children in D29.
No claim that those indirect PIDs are separately counted. All direct children
are synchronously awaited and owned fixture/package roots removed on settlement.

This is not a frozen acceptance policy for -n/index corner cases or failed
mutations. Native observations will inform the proposal, which root must approve
before implementation. Strong checked readonly writes, real cancellation/sink
identity, and logical safety budgets are not discarded for native imitation.
