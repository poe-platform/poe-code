# Bounded archive native-prerequisite replay

This runner replays only the two affected historical test files, unchanged,
from `e36dab2b6abc216ddc89e5786a0eba76f08a1722`. It does not build, install,
download, alter existing source/tests/configuration, or run a whole-product gate.
See `REPORT.md` for this execution and `PLAN.txt` for its pre-execution budget.

## Required existing tools

Run from `/Users/kjopek/Workspace/safe-bash` with Node 22 and the already-installed
lock-matching `tsx`, `esbuild`, and `@esbuild/darwin-arm64` packages. This is the
specific Darwin arm64 profile used by the existing tests, not a portable Linux
profile. No fallback to a different platform or native dialect is permitted.

Set `GNU_TAR` to an explicitly accepted, **already-existing regular executable**.
Its location is caller-supplied; the runner requires both GNU tar 1.35 and SHA256
`49a0bd353ad67347674d00a7b3eeb171da58728f7e4577c9b320d8ab1e7bba66`.
For this repository's existing pinned copy:

```sh
export GNU_TAR="$PWD/tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar"
node tests/commands/archive-stress/native-prerequisite-review/runner.mjs check-tools
```

The check also validates `/usr/bin/bsdtar`, `/usr/bin/gzip`, and `/usr/bin/gunzip`
against the fixed hashes/version dialects in `runner.mjs`. GNU/BSD version stdout
and Apple gzip/gunzip version stderr are retained separately. Unset `GNU_TAR`,
missing files, wrong hashes, wrong versions, or incompatible system tools fail
clearly. Obtain authorization separately if any tool is unavailable; this runner
never provisions packages or calls the existing network-based prepare script.

**The two original test files do not honor `GNU_TAR`.** Both require the literal
relative location `tests/commands/archive/.oracle/gnu-tar/1.35/bin/gtar`.
The setup runner copies the validated primary there **only inside its frozen
temporary tree**, with the same hash. `GNU_TAR` is our setup API, not an invented
test API. Both test profiles use the same explicit `GNU_TAR` target and
`PATH=/usr/bin:/bin`; PATH alone cannot resolve a hardcoded absent executable.
Existing test helpers retain their own exact native environment options.

## Prepare, publish plan, replay

Use a fresh dedicated workspace name; existing directories are rejected.

```sh
WORK=/tmp/safe-bash-archive-prerequisites-replay1
node tests/commands/archive-stress/native-prerequisite-review/runner.mjs prepare "$WORK"
```

Preparation freezes regular source/test/config files directly from the explicit
Git commit, not from moving HEAD. It copies only installed loader dependencies,
checks their lockfile versions and before/after content, and retains per-file
hashes plus current checkout/index qualification. No symlinked source or loader
alias is accepted. Registry archive integrity is not independently re-established.

Before executing tests, review `prepared.json` for the six exact names, snapshot
ID, tool profile and call budget, then publish the new plan. Preserve an existing
plan first rather than losing earlier evidence:

```sh
if test -f /tmp/safe-bash-archive-prerequisites-plan.txt; then
  cp /tmp/safe-bash-archive-prerequisites-plan.txt "$WORK/previous-plan.txt"
fi
cp "$WORK/prepared.json" /tmp/safe-bash-archive-prerequisites-plan.txt
node tests/commands/archive-stress/native-prerequisite-review/runner.mjs run "$WORK"
```

The first run intentionally has no GNU binary in the frozen tree; all six
historical failures must remain visible. The second adds only the verified
regular binary and runs the exact same two files, argv, environment and trace.
It is one execution per profile, no filters or retries. A rerun requires a new
workspace; it does not overwrite the original evidence. Changing the harness
after preparation invalidates its seal. Unexpected configured semantic failures
remain in raw logs and make the driver fail; do not revise test expectations.

`trace-native.mjs` observes the existing Node native calls without changing their
arguments/options, returned values, or thrown native errors. It records native
binary hashes, call pairs, raw available stdout/stderr, statuses and archive
artifacts. It is the same preload in both profiles, not a binary wrapper or
source patch. Successful `execFileSync` exposes stdout but not its captured
stderr through its return value; the trace records that unavailable field as
null, not a fabricated empty byte stream. Native gzip subprocesses and linked
system libraries are not separately syscall-traced or hermetically copied.

## Ownership, bounds, retained outputs

- Each test process has a 120-second deadline, 16 MiB output cap and owned
  process group. Per-test deadline is 60 seconds; original native call deadlines
  remain 8/10 seconds. Version probes have five-second deadlines.
- Native fixture writes are confined to the frozen archive directory or the
  explicit owned TMPDIR. Original `mkdtemp` suffixes/dynamic mtimes are unchanged;
  byte-identical native-created archives across dates are not promised.
- Native fixture directories clean themselves. Process-group and leftover-file
  records distinguish cleanup from intentionally retained evidence/snapshots.
- `evidence/*.result.json` retains argv, cwd, environment, status, bounds and TAP
  accounting. `configured-prerequisite-trace/` records actual oracle execution.
- The evidence bundled here is this run's immutable copy. New replay outputs
  remain under the new `$WORK`; do not replace these historical logs.

Scope excludes full 128/177/196 cohorts, global typechecking, WebDAV,
authentication, private poe-code, other owners' native fixtures and full gates.
