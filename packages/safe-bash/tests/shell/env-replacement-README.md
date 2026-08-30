# Exact invocation environment: author checkpoint

This bounded implementation integrates Curie's approved contract/core commit
`84fc74259706ee8d7a39680f098aa61d43b0085e`. It is not independent acceptance,
full Bash startup fidelity, full-shell completion or comparative superiority.
The root-granted lease followed source/dot/eval acceptance `641d6aa` on shell
source `489c8b7`; none of that earlier evidence or source was rewritten.

## Boundary and implementation

`ShellInvokeOptions.replaceEnv` mirrors the already approved shared optional
boolean. At `Runtime.invoke`, true selects a fresh copy of `options.env ?? {}`;
false/omitted preserves the original merge expression, including its PWD rule.
Existing key/value validation, literal argv construction and clone/execution
path are unchanged. The runtime change is one expression; the local type gains
one optional field. No export names, root exports, contracts, core commands,
manifests, dependencies, filesystem source or lifecycle code change.

Replacement concerns exported environment only. Previously exported child
values are removed before assignment; retained private clone variables stay
private, and the child's export set contains exactly the supplied keys. Child
functions remain available under existing literal-invoke behavior. An explicit
later export/cd can change that child's state. No lineage-wide suppression or
generic state reset is introduced: a later ordinary invoke still gets its
backward-compatible merge/PWD behavior. Parent state remains isolated.

`processState` is intentionally unchanged: it imports only `context.env`, not
private clone variables. A newly invoked Bash/sh interpreter may derive PWD
from its own cwd. This is distinct from the immediate command boundary, where
replacement never invents PWD and explicit supplied PWD is independent of cwd.
No broader startup defaults, environment shebang, syntax, source/eval or PATH
policy is added. Existing middleware, signal, shared budgets, descriptors,
input cursor and origin pass through the original path.

## Evidence

- Initial real Shell + `agentCommands()` red control: 11/29 pass, 18 fail;
  raw TAP retained in `env-replacement-red.txt`. This is not a claim of 18
  independent product defects: the new author harness also initially assumed
  an env output order and compared null-prototype maps to plain objects.
  Core GNU9.7 observation establishes VALUE before EMPTY in that case; map
  comparisons now explicitly compare own entries. No old tests were edited.
- Final author suite: 31/31; one test contains nine isolated safety assertions
  with a five-second child deadline (not nine additional TAP cases). Covers
  real nested env/pipelines, unset, empty maps, literal empty/space/dollar args,
  private/exported separation, child startup, cwd/PWD, function locals,
  explicit export, source state isolation, middleware, validation, typed
  cancellation/late rejection, binary/empty stdin, cursor/origin and five
  shared resource limits. The local type test compiles without casts.
- Unchanged current-shell: 43/43 leaves (44 TAP including parent). Unchanged
  source/eval author: 86/86. Frozen invocation/closure: 415/415 = 72+132+211.
- Final global/build/benchmark noEmit all exit0, with respectively 976/296/411
  pre-enumerated compiler inputs. No emitting build. All final before/after
  guards, actual TS imports and compiler path checks are stable. Initial
  owned excess-property type errors and an incomplete test-entrypoint guard
  enumeration remain recorded in `env-replacement-validation.json`; final
  checks followed those harness repairs, not foreign-source retries.

## Native controls and provenance

`env-replacement-native.ts` runs every one of 14 cases under both entire
profiles. `env-replacement-native.json` stores source strings, unmodified raw
base64 stdout/stderr, exit statuses, actual executable hashes/version output,
initial environment, cwd and source hashes. Final result is 14/14 exact for
GNU Bash5.3 and 14/14 exact for historical Bash3.2 on this focused cohort.

GNU5.3 executable is `/tmp/safe-bash-gnu-bash-5.3.Ua5t02/install/bin/bash`;
historical is `/bin/bash`. The sh child is an actual `sh` basename symlink to
the respective executable, not the host `/bin/sh`. GNU env9.7 is the pinned
build under `/var/folders/rw/s4cy76hn6v55qrp0dhcbtplc0000gn/T/safe-byte-gnu.0SnJMX/coreutils-9.7/src/env`.
Native env/interpreter/cat roles use explicit absolute tool paths; virtual
roles use real registry/interpreter names. This role binding is recorded in
every script, never stdout/stderr normalization. Native children have scrubbed
environment, isolated temporary cwd, three-second deadline, bounded output,
process-group cleanup and exited-PID checks. Product code spawns nothing.

Initial whole-cohort observations were 10/14 per profile: four cwd strings
differed because macOS maps `/tmp` to `/private/tmp`. They are preserved in
`env-replacement-native-initial.json`. The harness now resolves its temporary
cwd *before either execution* and supplies that identical absolute cwd to VFS
and native runs; it does not rewrite captured output. Both whole cohorts were
then rerun. Raw env order is retained, never sorted or reversed for comparison;
these passing selected rows do not reclassify earlier broader ordering losses.

Primary documentation: GNU coreutils manual `env invocation`, Bash manual
`Environment` and `Bash Variables` (official GNU pages). Local pinned GNU5.3
`variables.c:set_pwd`, lines907 onward, imports valid PWD or initializes it
from the working directory. Source SHA256 is
`e5c8be22b2805b32edcc50d75bf36fc767e8f540b403c50c2e48b6783591bd2e`.

## Reproduce / limits

From repository root:

```sh
node --unhandled-rejections=strict --import tsx --test tests/shell/env-replacement.test.ts tests/shell/env-replacement-bounds.test.ts
node --import tsx tests/shell/env-replacement-native.ts > /tmp/env-native-new.json
node tests/shell/env-replacement-verify.mjs /tmp/env-validation-new.json
```

The native reproduction requires the exact recorded binaries; the durable
captured evidence is committed, not dependent on retaining a temporary report.
The verifier requires a fresh output filename. Counts are worktree-snapshot
qualified, not a clean entire-HEAD/whole-product assertion during other owners'
work. No independent env expectations were read. The original9 historical
native gaps, five custom first-read cases, thirteen later source/eval historical
differences and unrelated expanded/BOM/jq cohorts were not rerun or waived.
Independent replacement acceptance still follows this source freeze.
