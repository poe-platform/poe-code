# Stage2 getopts runtime author scope

Root's current authorization supersedes the reservation recorded in f9d8737b.
Only `src/shell/runtime.ts`, `src/shell/shell.ts` and this new runtime test subtree
are owned. The accepted private helper and all earlier/independent evidence stay
unchanged. No root exports, contracts, plugin registration, generic declare or
typeset/builtin command, dependencies, public limits or O060 changes.

`getopts` is a regular builtin using existing middleware/discovery and shell
State. Internal metadata tracks its independent cursor and scalar OPTIND integer
attribute. Fresh exec/interpreter states initialize unexported OPTIND/OPTERR=1,
preserving inherited export bits; clones/invoke do not reinitialize. Successful
assignment/read/arithmetic/for/parameter/declaration stores synchronize OPTIND;
getopts publications do not. Local OPTIND restores function-entry cursor and the
outer binding attribute. Host overlays compare final effective values/presence.

## Root profiles, not native failure parity

- D01: publish hidden scanner, await any nonempty parser diagnostic, then checked
  OPTIND, checked OPTARG set/unset, late identifier validation and checked name.
  First checked failure stops, retaining earlier effects without rollback.
  Readonly OPTARG is never removed unchecked. Failed external stores do not reset.
- Temporary same-scope prefix restoration restores exact saved binding/metadata
  on success/failure/abort. This intentionally differs from native N04 even on
  success; N04 and native readonly captures are not rescored.
- D02: same Budget and normal command admission/cadence. Selected words retain
  per-word expansion byte caps, not a summed argv pool. Helper checkpoints yield
  at128 steps and final flush through existing interruptible setImmediate; no
  extra command/loop charge, work counter or deadline API. With B=per-word bytes,
  A=admitted selected args, private caps saturate safely at B*(A+1) bytes and
  2*B*(A+1)+A+2 steps. Caller AbortSignals provide actual cancellation/timeouts.
- D03: unchanged host forwarding/promotion does not reset; effective changes or
  removal reconcile child only. Exported omission in replacement removes without
  defaults; unexported omission survives. Direct middleware retains its original
  conditional visible restoration and pairs hidden restoration with that branch.
- ASCII options only, ordinary Unicode required values supported. Non-ASCII
  specification/option refusal uses explicit getopts error status2 without scanner
  publication. Helper safety refusal is not native byte-option parity. Shared
  limits, sink errors and caller reasons keep existing propagation/mapping.

Tests use actual Shell/registry paths. Test-only Runtime observation checks hidden
publication/budgets where abort makes subsequent shell commands unavailable; no
new production inspection API exists. Existing owned-output wrappers/callbacks
and cleanup semantics remain intact and require their separate regression runs.

Frozen original Stage2 evidence remains16 native scripts (14/16 original5.3
expectations matched; N05/N13 corrections retained), not runtime passes. Ten
nonfailure stdout cases are reused here without claiming native diagnostic byte
parity. New policy tests separately cover the corrections and intentional D01/N04
differences. Source/helper hashes, exact historical regression commands and the
accepted owned-output patch are in `baseline.json`; later validation records
bind the committed candidate and isolated archive, not a whole-product verdict.
