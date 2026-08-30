# Independent breadth/fairness preflight

## Decision and scope

**READY FOR ROOT COORDINATION; FINAL MEASUREMENT BLOCKED.** This is an
independent static review, not execution acceptance. No `Shell.exec`, `Bash.exec`,
command handler, native reference workload, optional runtime, or fixture server
was executed. No product constructor was called by this reviewer. No features,
dependencies, author inputs, setup artifacts, historical results, or tests changed.

The setup handoff is now READY at `5a410d8420cd764bb4a4df82b17613688a92f907`.
The executor's `9b72400ae2a5d1c876e8c9ab25bfa35bb03c8a97` handoff is explicitly a
**preparation-only** checkpoint with zero observations and no executable runner.
Its `prepared-inputs.json` contains `sourceSnapshot: null`. The independent root
release marker was absent at capture. Neither a prepared input list nor an
executor result filename constitutes permission to measure.

Prompt findings were published to
`/tmp/safe-bash-baseline-coverage-review-preflight.txt` before this checkpoint.
The first static attempt is immutable in `static-audit-001.json` and
`static-attempt-001.log`; its Node process exited normally with status 0.

## Census, not operational scores

| Population | Independently checked count | Meaning |
| --- | ---: | --- |
| Historical frozen rows | 53 | Preserve original 3 measured / 50 unmeasured; no history rewritten |
| Ours default registry | 56 | Concrete factory definitions; not classifier output |
| Ours default registry/kernel/interpreter union | 76 | Includes actual kernel dispatch and `bash`/`sh` entrypoints |
| Baseline default registry | 83 | Installed Node-bundle lazy registrations |
| Baseline default registry/kernel union | 120 | Concrete dispatch, excluding phantom classifier-only names |
| Current default baseline-only names | 50 | Exact match to the historical unmeasured target set |
| Additional optional baseline-only names | 4 | `js-exec`, `node`, `python`, `python3` |
| Historical names now overlapping | 3 | `.`, `eval`, `source`; current presence is not an execution pass |
| Declared recipes | 60 | 54 target names + 3 historical controls + 3 shared controls |
| Unique declared command names | 59 | Two separate `printf` controls use the same name |
| Missing target names in declarations | 0 | Static name coverage only |
| Operational measurements / successes / failures | 0 / 0 / 0 | Every recipe remains unmeasured by this reviewer |

The actual shared default-name intersection is 70; six names are ours-only in
the default comparison. Explicit shared optional curl is a control, never a
baseline-only or default-bundle win. The optional `safejs` public name is not
`js-exec`, `node`, or Python, and does not eliminate their name differences.

All 54 target names lack a corresponding public default/optional name on ours in
this inspected configuration. **This is not 54 missing functional capabilities.**
For example `egrep`/`fgrep` are name aliases for grep dialects; `typeset`/`declare`,
`readarray`/`mapfile`, and `python`/`python3` share implementation families on the
baseline. Different public names, option syntax, aliases, and unavailable runtime
injection must remain separate from actual workflow deficiencies.

Thirteen baseline classifier-only names are excluded because the concrete
dispatcher/registry does not establish them: `bg`, `caller`, `disown`, `enable`,
`fc`, `fg`, `jobs`, `kill`, `suspend`, `times`, `trap`, `ulimit`, `umask`.
Ours `echo`, `printf`, `test`, `[` are registry commands rather than implemented
kernel builtins; `false`, `pwd`, `true` have shadowed registry definitions.

### Non-operational and restricted boundaries

- One explicit kernel no-op: `wait`. The installed dispatch returns empty success;
  a completed sequential/background-spelled write cannot prove asynchronous join.
- One optional diagnostic runtime stub: `node`, routed to `nodeStubCommand`, not
  a host Node interpreter. The declared arithmetic attempt must remain a stub
  outcome, not earn status-zero or help-output functional credit.
- One documentation-only recipe: `help`; its `operationalCredit` is false.
- Two fixed virtual identity queries: `hostname`, `whoami`. Label their intrinsic
  informational behavior; never infer host identity, configurable identity, or
  permission enforcement from these strings.
- Completion specification storage (`complete`, `compopt`) is narrower than an
  interactive completion engine. The current proof limits say so correctly.
- Measured runtime/setup-unavailable count is **unknown**, not zero available or
  a baseline loss. Three optional executable spellings (`js-exec`, `python`,
  `python3`) have local assets, but none has been started by this reviewer.

## Findings requiring root/executor disposition

1. **F1 — unalias false-positive risk.** `unalias-positive` never enables alias
   expansion or demonstrates the seeded alias first. Installed default state
   includes `expand_aliases:!1`. The expected final output is compatible with an
   inert successful unalias. Require distinguishing before/after behavior or
   explicit alias-state removal before a functional credit can be accepted.
2. **F2 — hash claim exceeds evidence.** Mapping `echo` to `/bin/echo`, retrieving
   that mapping, then invoking normal `echo` proves storage/retrieval at most.
   It cannot distinguish a dispatcher ignoring that mapping. Narrow the declared
   claim or obtain root-approved distinguishing input before measurement.
3. **F3 — byte-control status masking.** `printf ... > bytes; cat bytes` ends with
   a helper status. Exact output/file bytes catch many failures but not a printf
   that writes expected bytes then returns nonzero. Preserve its status before
   freeze; do not silently repair this script during independent replay.
4. **F4 — corpus growth must be explicit.** The design proposes later census
   controls and direct-target probes. Root/author must declare and count them
   before the author run. The independent reviewer may not append probes to the
   released complete corpus or call a newly enlarged corpus the original 60.
5. **F5 — timer proof needs the right interval.** Measure the `sleep` lower bound
   around product execution, not child startup, imports, or VFS setup. Even then
   it is only the declared loose sanity bound, not timer accuracy/performance.

F1–F3 are concrete declaration issues; F4–F5 are execution-design conditions,
not observed harness failures. No author recipe was changed by this reviewer.
The committed preparation still has the inspected input hash below; a correction
must preserve it as historical evidence and receive an explicit new declaration
hash rather than retroactively alter an observed cohort.

Additional acceptance checks: final constructor values must reconcile the
setup-profile 5/15-second limits with the executor's proposed 30/120-second
budgets, including nested worker limits. Merely increasing a parent deadline is
insufficient. Full VFS capture must expose unexpected additions as well as the
declared positive files; a subset-of-files assertion is not complete effect
equality. Neither condition has an executable evaluator to audit yet.

## Setup and provenance checks

The observed Node is **v22.22.2**; installed baseline package and isolated lock
both say **3.4.2**. Lock SRI is
`sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==`.
This is a pin plus installed-file SHA256 evidence, **not tarball/signature
reattestation**. No tarball, binary, dependency, or optional asset was downloaded.

The pinned primary README at commit
`a021f95f53f7e01df48dab71b46ffd4637fb4b53` was fetched independently after web
inspection and is byte-identical to the installed README. `primary-checks.json`
contains hashes of five primary sources used to corroborate configuration,
registration and alias/hash boundaries, rather than duplicate the setup worker's
whole documentation investigation. Current upstream defaults were not used.

Read-only resolution from the installed worker directory locates sql.js and its
WASM, QuickJS, turndown, and vendored CPython locally. Python WASM/stdlib and all
three worker files were hashed. The real `tsx` import entry resolves to
`node_modules/tsx/dist/loader.mjs`, distinct from the `.bin/tsx` CLI symlink.
Seventeen symlinks across the two installed dependency trees resolve inside this
repository; the source-tree census has no symlinks. The runtime executable's own
realpath/hash is retained separately. These are **preflight candidate resolutions**,
not a trace proving a future snapshot's measured child/worker loader choices.

Do not disable defense settings, use browser builds for Node workers, replace
stub commands with native runtimes, or invent sqlite enablement flags. JS/Python
need their documented opt-ins; sqlite is a default registration. Assets present
does not prove startup. Ours' legitimate injected SafeJS runtime availability is
a different question from missing name-compatible command handlers.

Static capture at `2026-08-27T03:41:22.467Z` records live HEAD
`6fdb7024ef0bc90fb61d870668311299d8510eb6` and:

| Input/tree | SHA256 |
| --- | --- |
| Author `cases.mjs` | `45cfbf02a4e68483e2b4f0fe85dc2c72d40a2a6c16ede16420480c80eb160b72` |
| Setup `inventory.json` | `4496aedf610d3f0a6e79f099849af5a1becc0bb66652a770bea5b3d33943fff9` |
| Source-tree manifest, 165 entries | `793997b875dbdc9e61606dd5502869b2c8e875951e3fe57ceeb217c168e5710d` |
| Root dependencies, 318 entries | `c4e4006576ebfb788f59dd25db76189de55696cdf37c26273493bd2fe7dfbf27` |
| Baseline dependencies, 3510 entries | `4a467155d6bde22378487a3d699ec834d098150ea0254e41e7c23db65d0290d1` |

Tree hashes use the deterministic record encoding in `audit.mjs`; they are not
Git tree IDs. Individual relevant-file hashes, raw symlink destinations, case
declarations, exact synthetic environment, and handoff bytes are retained in the
audit JSON. This read-only live inspection is not an atomic execution snapshot.

The second static capture at `2026-08-27T03:45:40.880Z` demonstrates actual live
source drift: HEAD moved to `0b232952f269e0515b5f2c17638ebc2d71c913cb`, and the
165-entry source manifest changed to
`8c30a64838399bc319dfe56558cfd5d995bb6377233c388a2af51fc8239c723f`
(1,626,147 to 1,626,130 source bytes). Neither dependency-tree digest nor the
declaration hash changed. Relevant individually recorded command/dispatch files
also remained unchanged. The new HEAD is an S3 credential deadline change; this
is not reviewer work. This is positive evidence that a live HEAD must not be used
as a substitute for the author's frozen measurement snapshot. Both captures are
retained, not merged into a fabricated stable revision.

## Conditional engineering batches

These are five **source/case-plan-based engineering judgments**, not usage
telemetry, measured gap rankings, approval to implement, or superiority claims.
The final observed breadth report must corroborate or revise them after release.

| Order | Workflow and candidate batch | Coupling and caveat |
| --- | --- | --- |
| 1 | Log/text formatting: `rev`, `expand`, `unexpand`, `fold`, `nl`, `tac`; nearby `strings`, `seq`, `expr`, `printenv` | Existing byte I/O; no guest runtime or shell-state mutation. First six are the lowest-coupling author candidate, subject to independent measurement. |
| 2 | Inspect/generated artifacts: `column`, `split`, `tree`, `du`, `file`, `date`, `which`, `html-to-markdown`, `xan`, `yq` | VFS effects, format/locale policy and parsers; data converters are materially larger than their names imply. |
| 3 | Reuse shell scripts: `alias`, `unalias`, `builtin`, `exec`, `declare`, `typeset`, `let`, `getopts`, `hash`, `mapfile`, `readarray`, `shopt`, `pushd`, `popd`, `dirs`, `compgen`, `complete`, `compopt`, `history` | Kernel/state integration; aliases and completion metadata are not separate full engines. |
| 4 | Bounded data/runtime tasks: `sqlite3`, `js-exec`, `python`, `python3`, `sleep`, `time`, `timeout` | Runtime/assets/security/cancellation prerequisites; do not score setup-unavailable as a competitor defect. |
| 5 | Explicit compatibility/identity decisions: `egrep`, `fgrep`, `clear`, `help`, `hostname`, `whoami`, `wait`, `node` | Separate spelling aliases, intrinsic information, terminal bytes and two non-functional stubs. Not eight substantive missing implementations. |

All 54 target spellings appear once in this conditional partition. No batch is
authorized by this report. Network curl remains a shared explicit-local control,
outside the target batches.

## Reproduction and remaining gate

Run `node benchmarks/reports/baseline-only-20260827/coverage-review/audit.mjs`
from the repository root for **static validation only**. It reads installed
source/dependencies and imports only the already-inspected declarative case
module; it does not import either product. JSON goes to stdout. New evidence
files must use `apply_patch`, and reruns must not overwrite the initial capture.
The follow-up static audit adds independent classifier extraction instead of
trusting the setup classifier list; this is reviewer-harness hardening, not a
recipe/product correction.

Both static audit attempts exited 0 with empty stderr; `node --check audit.mjs`
also passed. The captured declarations exactly match `prepared-inputs.json` after
removing its per-case digest field. These are static validation results, not
product tests, parser execution, native oracle checks, or performance runs.

Before final independent execution, root must provide the review marker **after
main execution closes**, a complete author result, executable bounded harness,
and the same frozen actual source/baseline/dependency/config/input snapshot.
Inspect loader/native-asset/symlink resolution before any case starts. If that
snapshot cannot be reused, stop and ask root rather than mix live revisions.
Run exactly one complete released corpus, retaining first attempts, raw text and
bytes, ports, timing, full fixture namespace/content/available metadata, and
explicit stable projections. A failing pair is not parity; a public terminal
encoding limitation is not automatically internal VFS corruption.

Final measured missing/unsupported/setup-unavailable/stub counts, complete effect
equality, observed engineering rankings, and acceptance are intentionally
**pending**. There is no full-shell, full-parity, runtime-security, performance,
72-hour completion, or superiority claim. No fixture resources or product child
processes were created; short read-only tooling exited normally. No cleanup of
another worker's files or processes occurred.
