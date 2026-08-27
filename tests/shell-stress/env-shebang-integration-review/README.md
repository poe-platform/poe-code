# Independent env shebang freeze

Owned solely by the delegated leaf acceptance reviewer, not the source author.
Only this new directory and uniquely named `/tmp/env-shebang-review-*` fixtures
may be written. No source patch, historical evidence change, immutable8670 gate,
package modification, private checkout access, or new dependency is authorized.

## Frozen scope

Exactly **30 distinct cases**: 20 virtual shebang semantic cases, four accepted
direct-env regression controls, and six host integration contracts. Each case
has one independently motivated category in `corpus.mjs`; there are no generated
parameter cross-products. Host expectations and implementations are sealed along
with semantic inputs before any baseline product execution. No assertion is
derived from current output. Host cases are not native-parity claims.

The freeze commit precedes the baseline evidence commit. `seal.json` binds the
complete corpus, execution/evaluation harness, this policy, baseline source
commit, root build inputs, and authenticated existing oracle/tool identities.
Future replay must use the same sealed files. Changes require a disclosed new
version and may not replace this evidence. Keep hidden inputs/expectations away
from the implementation author; root handoff contains aggregates only.

## Protocol and oracle profiles

Primary target: Linux single optional argument plus GNU env splitting semantics.
On this Darwin host the reference explicitly supplies `[wholeHeaderSuffix,
scriptPath, ...tail]` to the authenticated GNU env executable. This is **a
user-space Linux-argv model running GNU env on Darwin**, not Linux kernel
execution, Linux libc qualification, or a direct CLI/kernelline equivalence
claim. Direct-env controls supply their own literal arrays and form a separate
partition. No native availability is invented. Missing or changed authenticated
tools make references unavailable, never passing.

Separately, the same twenty shebang inputs are actually executed through this
host's Darwin kernel and `/usr/bin/env` (or the declared unknown interpreter).
Those raw observations are historical/profile controls, never selected as the
primary oracle. GNU Bash 5.3 is selected through bounded local PATH shims for
both `bash` and `sh`; native delegate scripts retain their actual env shebang.
Native fixture files and virtual files have identical bytes and cwd coordinates.
No ambient credentials, shell startup files, network, or product native exec.

Semantic expectations fix exact stdout, exit status, original/effected file
bytes, file modes and complete namespace. Successful stderr is exactly empty.
Six named diagnostic cases use predeclared cause-specific virtual diagnostic
patterns, not native stderr equality; raw stderr is retained and strict native
tuple equality is reported **separately**, including those losses. Unknown
non-env interpreter is a virtual refusal policy case; no GNU env argv reference
is claimed for it. Bash -Z is the current virtual unsupported-option contract,
not a request to implement all Bash options. No ordering-sensitive environment
dump comparisons or new lifecycle/creation-mask policy are imposed.

Primary documentation read through web.run on August 27, 2026:

- GNU coreutils, env invocation: `https://www.gnu.org/software/coreutils/manual/html_node/env-invocation.html`
  (split-string grammar, expansion, option ordering and status categories).
- Linux man-pages project, execve(2): `https://man7.org/linux/man-pages/man2/execve.2.html`
  (the Linux optional argument is one string; other kernels may differ).
- GNU Bash, Invoking Bash: `https://www.gnu.org/software/bash/manual/html_node/Invoking-Bash.html`
- GNU Bash, Shell Scripts: `https://www.gnu.org/software/bash/manual/html_node/Shell-Scripts.html`
  (script argument binding and invocation flags).

These sources specify the model, not availability of a Linux runtime here.
No external document is executed or copied into product inputs.

## Execution and evidence

`node tests/shell-stress/env-shebang-integration-review/run.mjs capture SOURCE_COMMIT OUTPUT_NAME`

Use a new basename for OUTPUT_NAME; an existing directory is refused. The runner
authenticates a committed source/build-input archive, compiles in owned scratch
using the existing TypeScript dev tool, and imports only its compiled public
index in plain Node. Actual product JS loads are hash-bound to that archive's
dist output. Source and tools are checked before/after; live changes are recorded
but never overlaid into the committed archive. This is not a whole-source test
gate, packed-package acceptance, or build of the mutable working tree.

Every product case runs in its own bounded child, with denied native process and
fetch hooks, bounded output and timeout. Raw result/error/effects and child
status survive assertion failures. Native captures run before product cases.
All owned child groups and scratch are cleaned in finally; no dormant process
is used. Captures never overwrite prior artifacts. `run.mjs verify OUTPUT_NAME`
is read-only and verifies seals, evidence hashes, counts and cleanup.

Dependencies: existing Node >=22 (registerHooks), TypeScript dev install, system
Git/tar for archival, and the hash-authenticated historical GNU env/Bash and
Apple env binaries when available. No install or network is performed by runner.
