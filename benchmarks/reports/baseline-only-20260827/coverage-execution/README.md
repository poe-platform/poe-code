# Baseline breadth execution — preparation, not results

This owned subtree prepares a read-only product comparison. **No meaningful
benchmark case has been executed by this leaf.** Execution requires both the
root marker `/tmp/safe-bash-baseline-coverage-execute.ready` and the setup leaf's
completed handoff. The marker is owned by root and must never be manufactured
by this runner.

`cases.mjs` declares 60 recipes: all 50 historically unmeasured names, four
additional optional names, the three newly overlapping historical names, two
shared byte/dispatch controls, and one explicitly enabled loopback curl control.
The original 53 inventory rows and their original 3 measured/50 unmeasured
observations remain untouched. Draft expectations are authored before scoring;
they are not observations or claims that all names work.

## Setup requirements before execution

- Read the completed `../coverage-setup/` handoff, retain its exact inventory
  rows, primary evidence, documented configuration and availability limits.
- Verify installed just-bash **3.4.2**, its lockfile SRI, package/runtime asset
  hashes, loader realpaths and symlink targets. Installed-file hashes are not a
  tarball-signature or publisher-SRI reattestation.
- Freeze one current `src/` tree in a uniquely owned `/tmp` snapshot; retain all
  source bytes' hashes, symlink targets, package manifests and git/index state.
  Load ours only from that snapshot. Hash existing development/comparator
  dependency trees and loader targets before/after; do not install or update.
- Use actual public Shell/registry and Bash/kernel dispatch. No command
  replacements, implementation shims, native utility fallback, private runtime
  imports, or manufactured aliases for missing commands.
- Baseline `javascript:true` enables shipped QuickJS; `python:true` enables
  shipped CPython. SQLite uses shipped assets. Optional runtimes get 120 seconds,
  versus 30 seconds for tiny ordinary fixtures, with explicit timeout labels.
  The exact documented setup remains subject to the setup leaf's final handoff.
- Ours' `safejs` is not a name-compatible implementation of node/js-exec/python.
  The setup leaf found no installed runtime in the allowed package roots. No
  private checkout is searched, installed or loaded. Keep optional-runtime
  unavailability separate from name-compatible handler absence.
- Curl is a shared optional control, never a default or baseline-only win.
  Only one explicit `127.0.0.1` origin and fixed GET resource may be authorized;
  no external workload traffic, arbitrary host filesystem or broad allow-all.

## Capture and comparison policy

Each case uses a new in-memory filesystem and shell. Scripts, argv where literal,
stdin bytes, environment, fixture bytes/modes, expected status/output/effects and
proof limits are declared in `cases.mjs`. For compound scripts the exact script
is authoritative; `targetArgv:null` does not invent a reconstructed parse trace.
Positive prerequisites use `&&`, preserving target failure instead of letting a
last print command turn a failure into status zero.

Capture public stdout text and bytes separately, stderr text and available bytes,
exit status, host transport diagnostics, elapsed time, exceptions and timeouts.
Baseline stderr exposes text, so UTF-8 encoding it is derived data, not a raw
stderr byte API. Preserve `stdoutEncoding` and the public byte conversion API.
The binary control distinguishes terminal conversion from internal VFS bytes.

Capture before/after VFS namespace, actual entry type, complete bounded file
content, symlink target, mode and every available public stat field. Do not
invent uid/gid/inode/timestamps that an adapter omits. Preserve raw clocks and
opaque identity type descriptions; such descriptions are not identity equality.
Compare declared bytes/effects and input preservation. Raw timestamps/inodes,
baseline automatic infrastructure paths, timing text and dynamic server ports
are not silently normalized into equality. Report semantic checks separately
from raw cross-engine equality and full-census limits/errors.

Every failed/harness-corrected attempt needs a new immutable capture directory.
Missing handler, unsupported option, partial behavior, baseline stub, disabled
optional feature, unavailable setup, timeout and harness failure are different
labels. Both sides failing cannot produce parity success. Every original row is
retained, including newly overlapping controls and non-operational names.

`help` intrinsically returns documentation: its attempt is retained but is not
operational proof under the user's rule. `wait` needs actual job-join behavior;
the pinned no-op cannot receive credit merely because a sequential child write
appears. `node -e` must execute arithmetic; its diagnostic stub is not JavaScript
support. `hostname`/`whoami` only claim fixed virtual identities, not host identity.

## Pending deliverables

Execution runner, frozen inputs/manifests, immutable raw observations, per-name
machine-readable matrix, distinct functional controls and blocked cases,
before/after drift evidence, cleanup evidence, and engineering-judgment batches
follow root release and completed setup. No parity, superiority, performance or
full-shell completion claim is made by preparation.
