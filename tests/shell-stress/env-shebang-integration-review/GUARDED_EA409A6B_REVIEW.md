# Independent guarded candidate review — August 27, 2026

Candidate: `ea409a6b49d5c1523e3238f0384048218b559c4c`.
Runtime SHA256: `4e937b71df3135d1262a616924b4173e982f236dd86415e0e75895eac9c85e06`.
This fresh independent leaf is neither an env-S author nor an earlier reviewer.
No production, original fixture, oracle, report, contract, package or private file
was edited. Only new files in this review directory and the requested ROOT
checkpoint were written. No additional worker was spawned.

## Decision and preserved denominators

**Scoped PASS under ROOT's explicit guarded policy revision.** The unchanged
frozen corpus has **30/30 raw and qualified passes**, all structured observations
available: 20/20 shebang, 4/4 direct-env, 6/6 host. No frozen timeout, overflow or
denied-host-hook attempt occurred. This is not full-suite or native parity.

| Independently executed committed inputs | Result |
| --- | --- |
| Frozen public-entry corpus, unchanged | 30/30 |
| New guarded author tests within the complete author files | 19/19: 11 direct tests, 8 bounded host children |
| Complete author files, unchanged | 47/48; one retained closed-policy assertion |
| Core env/invoke controls, unchanged | 125/126; one retained old refusal |
| Script/interpreter controls, unchanged | 203/210; seven retained old refusals |
| Lifecycle/provenance controls, unchanged | 115/115 |
| Public registered grep/rg lifecycle controls, unchanged | 10/10, separately bound to the same exact commit |
| Strict primary native tuples | **17/23**, separate from semantic 30 |
| Actual Darwin kernel observations | 20 attempts, including the unknown-interpreter launch error |

All control suites have zero skipped, cancelled or TODO tests. The 115 and 10
lifecycle rows together reproduce the author's 125-row selection; the public
ten require their existing helper/probe and an explicit committed-input manifest,
so they ran in a separate archive rather than silently falling back to live code.

Original `dc262a99`/`fb10ee85` remains **27/30**. Original baseline remains **7/30
raw, 6/30 qualified**; its earlier loader failure remains 0/30 observations,
not thirty product failures. The audit reauthenticates all 37 preexisting tracked
review files against the candidate tree, both original freezes, both baseline
captures and the historical candidate capture. Nothing is replaced or relabeled.

## Frozen outcomes and remaining diagnostics

The prior s20 executable delegate now produces its frozen expected literal argv
output and unchanged file effects. h04 observes the synthetic `env` stage while
the live one-byte-high-water-mark pipeline still returns exactly `ab`. h05 reaches
the registered probe with exactly `{KEEP: "child"}`, literal script/user argv,
unread `abc`, false input origin and unchanged parent `TOKEN` output.

h06 is a qualified pass, not the old baseline's diagnostic-only false positive:
the actual route is `./script → env → bash → ./inner → env → bash → printf`,
then `ShellLimitError(maxOutputBytes)` from the three-byte producer under the
two-byte limit. No expectation was strengthened or replaced for this replay.

Six strict tuple losses remain: s03/s17/s18/d02 differ in stderr bytes, while
s12/d04 retain physical `/private/tmp` versus virtual `/tmp` stdout spellings.
Statuses and complete file-byte/mode/namespace effects match in all six. The
semantic corpus already declares its diagnostic expectations; no new diagnostic
normalization or path rewrite was introduced. These four diagnostic-policy losses
are distinct from the historical **three CLI diagnostic-prefix losses**.

The primary reference is the authenticated **GNU env 9.7 / GNU Bash 5.3**
single-optional-argument model **running on Darwin**, not a Linux kernel. Actual
Darwin kernel execution remains a separate raw profile. Historical five GNU and
three Darwin protocol losses remain historical; this replay does not repair them.

## Nine retained assertion conflicts

All eight old core/script rows remain unchanged in committed tests, with their
failed TAP retained. The supplementary observer uses the same eight original
source strings, cwd, command and assertion descriptions byte-for-byte. The only
observer adaptation catches and records rejection so the now-recursive bare-env
case does not prevent later rows and cleanup from being observed.

| Old assertion/source | Current observation | Classification |
| --- | --- | --- |
| `env-split-author/resume-host.ts:94`, `bash -e` | 127, empty stdout; only script remains | Old 126/unsupported-header assertion conflicts with the missing literal command |
| `errexit-host.test.ts:131`, `bash -e` | 127, empty stdout | Same missing literal command |
| `errexit-host.test.ts:131`, `-S bash -e` | 0, `BAD` | Body has no failure; old refusal/empty-output expectations conflict with supported execution |
| `expanded-gaps-env-host.test.ts:7`, `bash -e` | 127, empty stdout | Missing literal command |
| Same source, `-S bash -e` | 0, `forbidden` | Supported execution, not an old refusal |
| Same source, `python` | 127, empty stdout | No registration; native supplementation uses explicitly python-free PATH; no Python support inferred |
| Same source, no optional argument | Rejection: `ShellLimitError(maxSubstitutionDepth)` | Exact `/script` is now an allowed VFS target and recurses to shared limits; neither old 126 nor old closed-policy 127 |
| Same source, `bash\r` | 127, empty stdout | CR remains a literal missing-command byte |

All eight script contents and namespaces remain unchanged; no effect/marker file
appears. Seven finite native supplementary outcomes agree in status/stdout, not
missing-command stderr bytes. The bare-env native supplemental probe reaches its
declared 300 ms deadline and is killed; recursive re-entry uses the actual Darwin
kernel. That timeout is retained, is outside the frozen thirty, receives no pass
credit, and is not a settled native status or Linux/native equivalence claim.
The new author test independently exercises this profile at depth limit four.

The ninth failure is the **prior author's**
`registry, function and PATH names cannot hijack the reserved interpreter` test:
its later `alien` assertion still expects 127, but its explicitly registered
handler now returns pinned status 37 under ROOT's new policy. Its earlier reserved
`bash` override refusal still succeeds. The later old `hijacks === 0` expectation
would also conflict with executing `alien`. New guarded tests independently check
registry pinning against functions/builtins, replacement during middleware and
reserved-env protection. No blanket test rebaseline is proposed.

## Source and lifecycle audit

The exact candidate-parent diff is retained in the new audit directory. Its only
changed paths are runtime and the two author test files. A TypeScript AST/text
comparison verifies that only the type-import additions, `envShebang` and three
new private helpers change; **ordinary invoke/invokeScoped/executor/discovery,
interpreter and scriptFile are unchanged from this candidate's parent**. Core
`execution.ts` and `env-split.ts` remain byte-identical to the accepted baseline.
No public contract, root export, package, ownedOutput or private integration change
is present. Intervening column/internal/text source changes since `dc262a99` are
listed separately in the audit, not attributed to this three-file commit.

- `shebangTarget` at runtime line 1198 admits only literal reserved bash/sh,
  slash-containing VFS targets, or exact registered definitions. Definitions are
  selected before target middleware and retained for dispatch. Functions/builtins
  cannot shadow them. Reserved registration refuses 126; slash targets call
  direct `scriptFile` and perform their own stat/type/access/read checks, including
  a same-file chmod witness. No basename alias, PATH search, bare-file fallback,
  host filesystem/process/eval or fallback after target failure is introduced.
- `envShebang` at line 1244 uses the existing accepted cached env handler behind
  middleware, with zero/one unsplit optional argument, script and user argv.
  It does not rediscover registry `env`. Both synthetic env and selected target
  are observed, but the synthetic stage adds no command/depth charge. Existing
  loaded-source reuse and the reserved one-read/depth-one boundary remain intact.
  Registry/VFS cycles incur shared depth/command/source limits; ordinary script
  body PATH/function behavior and registered handlers' nested invoke stay ordinary.
- `shebangState` at line 1140 copies and validates state/env/cwd. Exact replacement
  uses only the supplied map, including omitted-map empty replacement; no PWD or
  local variable promotion occurs at registered command entry. Cwd is independent,
  and parent state is isolated. Reserved shell initialization still has its existing
  PWD behavior. Middleware may update env/cwd or short-circuit without retargeting.
- `shebangStage` at line 1152 creates a tracked child through `scope.child()` before
  middleware/owned acquisition; it registers input cleanup before constructing
  replacement `ShellInput`. Per-stage admission checks precede middleware/terminal
  work, nested invokes bind the correct scope, and `finally` awaits the idempotent
  scope close. Replacement sinks use the shared budget; unread input and transparent
  origin are preserved, and replacement origin is explicit. No collector/output
  owner or new public lifecycle hook is added.
- Scoped interruptible execution is separate from the unchanged command/caller
  signal exposed to hosts; scope closure is not misclassified as caller abort.
  Downstream errors are captured around env's `define` wrapper and rethrown inside
  the env terminal, so middleware sees original identity. Statuses are validated.
  Existing/new bounded controls exercise caller errno-shaped reason identity,
  middleware wrapping, cleanup failures, closed/late invoke, delayed rejection,
  sink/input cancellation and nonsettling opaque env/target handlers. Registered
  cooperative cleanup drains before public settlement; opaque losing handler/read
  promises are not thereby promised forced termination or universal cleanup.

No new implementation defect was established within the authorized scope.

## Reproduction, integrity and cleanup

Preparation began at 15:18:58 UTC. The bounded wait completed at 15:20:14 UTC;
candidate commit/runtime and both test hashes were validated before execution.
No mutable-working-tree candidate or fallback was executed.

```sh
node tests/shell-stress/env-shebang-integration-review/run-v2.mjs capture ea409a6b49d5c1523e3238f0384048218b559c4c NEW_unique_guarded_OUTPUT
```

The exact frozen execution ran 15:20:40.967–15:21:01.114 UTC into
`guarded-ea409a6b-20260827-review1`: 225 authenticated source/build inputs and
5,220 authenticated compiled public-entry module loads. All sealed corpus,
native-profile and evaluation bytes are reused unchanged. Existing directories
are refused, not overwritten.

New `guarded-controls-ea409a6b-v1.mjs` versions the historical controls wrapper:
only candidate/output/observer bindings, marker validation, explicit lifecycle
selection and stronger regular-file inventory reporting change. It ran
15:21:48.902–15:22:25.194 UTC with 480 archived inputs. Tests/helper inputs are
unmodified. `guarded-observe-ea409a6b-v1.mjs` discloses only rejection observation;
the original observer and wrapper stay immutable.

New `guarded-public-controls-ea409a6b-v1.mjs` selects only the existing public ten
and their helper/probe, builds an independently Git-derived expectation, and
supplies both existing committed-qualification environment variables. Its 228
inputs ran 15:23:29.569–15:23:49.269 UTC. The helper's nested snapshot also reports
the exact candidate, not captured-working-tree qualification. This is not a packed
package test; the author suite's moved-package consumer merely copies built files.

Source/dist/tool inventories and native binary hashes are stable. The unchanged
frozen runner's source postcheck checks original regular paths, **not appended
source entries**. New controls compare complete regular-file keys/hashes, detecting
new regular files but not new empty directories or symlinks. The public helper's
source/dist census rejects symlinks, but does not establish an empty-directory
census. These are explicitly bounded integrity claims, not an append-proof tree.

`guarded-audit-ea409a6b-v1.mjs` independently rechecks actual absence of **75 frozen,
14 scoped and 2 public-control process groups**, plus all **10 public probe PIDs**.
All three archive scratch roots and the public helper's nested snapshot are absent.
Unchanged author host tests additionally verify child PID absence through their
existing `settled` helper. Public grep/rg proofs record zero live owned workers and
no unhandled rejection. All reviewer runners and the wait loop finished; no stopped,
dormant or owned background process remains. Authenticated preexisting native-tool
installations and other owners' scratch were not removed.

Intentionally retained artifacts are the four new capture/audit directories,
four versioned reviewer scripts, this report and ROOT's requested `/tmp` checkpoint.
Raw TAP and exact source diff retain their original whitespace, including lines
that a blanket diff whitespace check may flag. Authored reviewer scripts/report
receive a separate scoped whitespace check; raw evidence is not reformatted.

No full suite, strict all-input typecheck, packed acceptance, deployed Linux,
universal native parity, provider qualification, whole8670 qualification,
superiority, performance or 72-hour-completion claim is made.
