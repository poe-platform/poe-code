# Executed baseline-only breadth audit — August 27, 2026

**Actual bounded execution, not product completion.** The corrected run covers all
50 previously unmeasured default names and four additional optional spellings.
It retains the original53 historical inventory rows, the three source/eval/dot
controls, and four shared controls. No product, dependency, old report, setup,
test or root file was changed. No native product fallback or new tool was added.

## Results and denominators

| Cohort | Ours | Pinned just-bash3.4.2 |
| --- | --- | --- |
| 50 default target spellings | 50 observed missing handlers | 45 strict positives;2 functional gaps;1 working hierarchy/display mismatch;1 informational;1 no-op |
| 4 optional target spellings | 4 observed missing compatible handlers | Python/Python3 positive;JS guest succeeds but cleanup fails;node diagnostic stub |
| 3 historical overlap controls | 3 positive | 3 positive |
| 4 shared controls | 4 bounded positives | 3 positive;1 binary file/terminal mismatch |

For the54 target census, baseline has **47 strict positives,2 functional gaps,
1 display-profile mismatch with successful hierarchy,1 successful guest with
failed cleanup,1 informational name,1 no-op and1 diagnostic stub**. Configured
setup-unavailable/default-disabled counts are0/0 on both sides. Missing handler
counts on ours are54:47 primary dispatch results plus7 direct-target diagnostics.
The primary array/background/prerequisite failures alone are **not** dispatch proof.
These are missing **names in this public configuration**, not54 absent workflows:
alternative spellings/options and the separate optional SafeJS host API are not
replaced, disproved or counted as installed runtime support.

Corrected corpus: **61 primary recipes +7 diagnostics per engine =136 calls**,
all with captured results and complete before/after censuses. **135 children exited
normally;1 required SIGTERM after cleanup grace.** The strict all-normal gate is
red, not waived. Diagnostics never inflate primary positive coverage. Both-failing
is never parity. Original20b889b's53/3/50 and preparation9b72400's zero observations
are unchanged; these are new observations, not overwritten historical scores.

## Actual per-name census

| Target | Ours | Baseline observed attribution |
| --- | --- | --- |
| alias | missing; primary dispatch | positive |
| builtin | missing; primary dispatch | positive |
| clear | missing; primary dispatch | positive |
| column | missing; primary dispatch | positive |
| compgen | missing; primary dispatch | positive |
| complete | missing; primary dispatch | positive |
| compopt | missing; direct diagnostic | functional gap |
| date | missing; primary dispatch | positive |
| declare | missing; primary dispatch | positive |
| dirs | missing; direct diagnostic | positive |
| du | missing; primary dispatch | positive |
| egrep | missing; primary dispatch | positive |
| exec | missing; primary dispatch | functional gap |
| expand | missing; primary dispatch | positive |
| expr | missing; primary dispatch | positive |
| fgrep | missing; primary dispatch | positive |
| file | missing; primary dispatch | positive |
| fold | missing; primary dispatch | positive |
| getopts | missing; primary dispatch | positive |
| hash | missing; primary dispatch | positive |
| help | missing; primary dispatch | informational only |
| history | missing; primary dispatch | positive |
| hostname | missing; primary dispatch | positive |
| html-to-markdown | missing; primary dispatch | positive |
| let | missing; primary dispatch | positive |
| mapfile | missing; direct diagnostic | positive |
| nl | missing; primary dispatch | positive |
| popd | missing; direct diagnostic | positive |
| printenv | missing; primary dispatch | positive |
| pushd | missing; primary dispatch | positive |
| readarray | missing; direct diagnostic | positive |
| rev | missing; primary dispatch | positive |
| seq | missing; primary dispatch | positive |
| shopt | missing; primary dispatch | positive |
| sleep | missing; primary dispatch | positive |
| split | missing; primary dispatch | positive |
| sqlite3 | missing; primary dispatch | positive |
| strings | missing; primary dispatch | positive |
| tac | missing; primary dispatch | positive |
| time | missing; primary dispatch | positive |
| timeout | missing; primary dispatch | positive |
| tree | missing; primary dispatch | hierarchy works; display mismatch |
| typeset | missing; primary dispatch | positive |
| unalias | missing; direct diagnostic | positive |
| unexpand | missing; primary dispatch | positive |
| wait | missing; direct diagnostic | no-op; no credit |
| which | missing; primary dispatch | positive |
| whoami | missing; primary dispatch | positive |
| xan | missing; primary dispatch | positive |
| yq | missing; primary dispatch | positive |
| js-exec | missing; primary dispatch | guest succeeds; cleanup fails |
| node | missing; primary dispatch | diagnostic stub |
| python | missing; primary dispatch | positive |
| python3 | missing; primary dispatch | positive |

Machine-readable final classifications and all57 preserved original/optional row
objects are in `attempt-002/final-matrix.json`. Frozen strict outcomes remain
in `attempt-002/results.json`; raw bytes/status/census/trace are under its raw/
directory. Root's reporting ruling supplements, never rewrites, those observations.

## Important distinctions

- **compopt:** status0 but no retrieved nospace/deploy state in stdout; unmet
  declared behavior. **exec:** child prints correctly, but the forbidden later
  statement creates after-exec. These are the two functional gaps on these recipes.
- **tree:** correct hierarchy and1-directory/2-file count, with ASCII connectors
  instead of the prepared Unicode display. Strict bytes fail; semantic traversal
  works. This is an over-specific display predicate, not a missing/partial tree tool.
- **js-exec:** status0, stdout42-newline, empty stderr, complete census,196.796541ms
  product execution. Process remains alive beyond10-second cleanup grace; SIGTERM
  ends it. It is not disabled, missing, startup-unavailable or a120-second guest
  timeout. Removing inherited tracing did not establish a cause or fix cleanup.
- **help/node/wait:** documentation, a diagnostic stub and no-op attribution are
  not runtime/job-control proof. Ours wait primary is rejected for unsupported &;
  its separate wait invocation returns127. No claim that ours implements no-op wait.
- **binary control:** expected007f80ff; baseline VFS file and public terminal byte
  conversion both contain007fc280c3bf. Therefore this is not only terminal encoding.
  This particular recipe contains no pipe and proves no general pipe corruption.
- **modes:** shared curl/census output files are0666 on ours and0644 on baseline.
  Their bounded content expectations pass, but complete effects are not identical.
  Initial infrastructure modes also differ. Raw fields and effect differences stay
  visible; no hidden mode normalization into parity. The explicit0600 file and
  symlink input census/preservation checks pass on both engines.
- **sleep/hash:** sleep's10ms lower bound uses only product exec, excluding setup;
  it is loose sanity, not timing/performance proof. Hash proves stored map retrieval,
  not dispatch through that map. time is forced through command time, not a keyword.

## Fair configuration and frozen identity

- Node v22.22.2; darwin/arm64;
  actual executable `/Users/kjopek/.nvm/versions/node/v22.22.2/bin/node`.
- Baseline installed3.4.2 Node ESM bundle, lock SRI
  `sha512-T0Vpy7YRgCjxJdqG3tkxn0ZnIDLJvVwb8hH4L+6NVdp+Te27jQxjxnszW9ODjEKbWxWujj83rP5S0GQxCSufgg==`. Installed-file/tree SHA256 plus lock
  metadata, **not** tarball/signature reattestation. No install/download/new dependency.
- javascript:true for js-exec/node; python:true for Python spellings; SQLite default
  registration with local sql.js. QuickJS0.32.0, sql.js1.14.2 and vendored CPython
  python.cjs/python.wasm/python313.zip paths/hashes are recorded. No CDN/native fallback.
- Optional product budget120s; ordinary30s; cleanup10s. Default defenses stay enabled.
  Main-only trace is not inherited by baseline workers. Actual module resolutions
  are distinct from statically resolved worker/WASM/stdlib assets; no syscall-trace
  claim is made about uncaptured worker-internal reads.
- Ours uses real Shell, agentCommands and memory VFS; curl is explicitly enabled.
  Exact local GET-only authorization, fixed response, bounded transport and synthetic
  environments only. Both corrected curl requests hit the controlled fixture.
  Positive curl limits remain supported defaults; there is no false zero-redirect
  configuration claim. The local server emits no redirect and is closed afterward.
- One source snapshot from first freeze is reused: `/tmp/safe-bash-baseline-coverage-execution-1787803035592-37307`.
  SHA256 **30f5cfb47f69af0aeb4460fa901904d0b70f4ca8594013f70aa308dafb379732**. Copied package/config hashes and explicit
  TSX_TSCONFIG_PATH bind the preserved snapshot; source loads never use moving HEAD.
  Snapshot/config/dependency/harness/observed-loaded-file checks pass. Live parser.ts
  and runtime.ts drift is separately recorded, not accepted as the measured subject.

Input file SHA256: `5a8dc009375fbc373b4bb708f75aee7f0be8f7088812aac4d73260dff9127e6c`.
Manifest SHA256: `185eb4bb8dd79b8c51a39458043f8b592b0d36823a47320e0536b3f4346fecb4`.
The manifest includes source/dependency/symlink/Node/worker assets, original HEAD and
dirty/index state, effective port/env/config, root authorities and harness hashes.
The frozen namespace-policy phrase fixture/tmp/infrastructure is stale prose:
actual corrected setup and censuses omit /fixture/tmp as root explicitly approved.

## First attempt is preserved, not scored as product failure

Attempt001 has132 launches/131 product calls/71 captured final reports. Final IPC
messages were dropped before flush, ours curl supplied unsupported zero limits,
and the unused scratch directory conflicted with shopt's expectation. Its JS child
reached after-census/cleanup in about180ms, then hit the140s outer guard; guest result
is unavailable there. The130 loaded-file audit mismatches were /tmp versus /private/tmp
aliases, not130 demonstrated live-source escapes. Original raw booleans remain false.
Root authorized all corrections before attempt002 freeze; identical source is reused.

Across both attempts: **268 launches,267 product calls,266 normal exits,2 SIGTERM
cleanup exceptions,0 SIGKILL**. All children and both fixture servers are closed.
No dormant worker, native fixture tree or product output was retained. Only the
read-only source snapshot remains in /tmp for authorized independent replay.

## Validation and reproduction

- Declaration/schema/assessment sanity and all runner syntax checks passed.
- `attempt-002/evidence-validation.json` verifies all136 reports, original
  rows/preparation hashes, complete censuses, recomputed unchanged assessments,
  immutable source/config/dependencies/harness and bound loaded paths.
- `attempt-002/strict-validation-failure.json` preserves the failing strict
  all-normal-child assertion. Evidence validity is not a clean lifecycle pass.
- `EXECUTION.md` documents launch/capture rules. `run.mjs` creates a new
  attempt and never overwrites an existing one. Do not invoke it as an unapproved
  replay. The different reviewer must use the frozen136 inputs/source/config and
  recorded loopback endpoint after root's closed-author release, outputting only
  within reviewer ownership. No extra cases, product changes or forced-normal exit.

## Next batches — engineering judgment, not telemetry

1. **Text compatibility/log inspection:** egrep/fgrep plus numbered/reversed/wrapped
   text and string extraction. Lowest-coupling author slice: egrep/fgrep only,
   after verifying underlying grep mode/option semantics, literal dispatch and
   cancellation/byte budgets; root-owned registration and independent VFS/pipeline
   review are prerequisites. No aliases are installed by this audit.
2. **Virtual repository/artifact inspection:** split/tree/du/file, with bounded
   traversal, symlink policy, logical-size semantics and real remote-adapter review.
3. **Shell-script state:** option parsing, arrays, aliases, directory stacks and
   environment/name lookup. Requires parser/runtime ownership, not registry labels.
4. **Bounded execution/lifecycle:** builtin/exec/time/timeout/sleep/wait with actual
   child dispatch, budgets, state and cleanup semantics—not no-op substitutions.
5. **Structured data/explicit guests:** yq/xan/sqlite/JS/Python; resolve zero-dependency,
   optional local assets, legitimate injection and disposal design before authoring.

`next-batches.json` lists exact targets, evidence, coupling and deferred names.
Current independent feature verification and remote interoperability still take
priority. These are proposed future batches, not authorization or implementation.

## Remaining limits

One selected recipe per target is not complete option coverage. No native workload,
broader backend conformance, performance comparison or independent replay ran here.
The explicit JS cleanup failure remains open. SafeJS has no legitimate injected
runtime in this allowed setup and is not a compatible replacement for four missing
spellings. All losses, display differences, unavailable runtime boundary and special
non-operational names remain visible; no broad parity or superiority follows.

Historical SGID six strict differences remain GNU9.7/Darwin profile observations,
not demonstrated POSIX defects or a reason alone for a permission API. Environment
ordering is POSIX-unspecified; the recorded native profile is Darwin/libSystem, not
Linux. Those normative records were read, not rerun; no SGID/env corpus expansion.
The full user goal and requested72-hour duration are **not complete or demonstrated**.
