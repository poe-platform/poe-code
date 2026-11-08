# Independent core env split review — August 27, 2026

**Core-only, partial evidence; not a shebang-completion or all-host acceptance.**
The complete setup-v2 frozen48 rows and seven hosts run once against authenticated
source `84ab66ca717e0dff21abf57051b41cb553f3c7f3`. No source, original helper,
fixture, native capture, expectation or existing evidence is edited. No author
test expectations are used as the oracle. No extra product reproduction or
fresh native capture is added after observing failures.

## Raw results and preserved history

| Profile | Exact rows | Strict mismatches | Setup unavailable | Hosts |
| --- | ---: | ---: | ---: | ---: |
| Original `7839db5370fe09d57f7aaaea29b5b2acb874cd36` baseline | 1/48 | 41 | 6 | 0/7 |
| Corrected `258879a4fae6b7e771ff2f266396c97e39400130` baseline | 2/48 | 46 | 0 | 0/7 |
| Current core candidate | **40/48** | **8** | **0** | **6/7** |

Current command rows are39/42 exact; single-optional shebang rows are1/6 exact.
All48 actual product status/stdout/stderr/effects-with-modes observations exist.
All55 original slots execute once, with no timeout, signal, overflow or surviving
child group. The one host assertion failure has no structured return record;
it remains a failure, not a removed denominator or pass.

Current raw statuses:31 zero,9 status125,6 status126,2 status127. The nine125
results are exact native-backed invalid-grammar tuples, not unsupported-green
characterizations. Independent field matches: status43/48,stdout44/48,
stderr40/48,full effects44/48. Exact success requires all four fields together.
Original native bytes, diagnostic text and modes are never normalized.

### Three command diagnostic/profile losses — not raw passes

- `packed-non-s-single-operand`: both127 and unchanged effects; GNU emits its
  missing-file diagnostic plus the `-[v]S` hint, virtual literal registry lookup
  emits `shell: line 1: argvprobe two words: command not found`.
- `missing-command-negative`: both127 and unchanged effects; GNU `env` missing
  file diagnostic differs from the virtual shell command-not-found diagnostic.
- `nonexecutable-command-negative`: both126 and unchanged effects; GNU prefixes
  `env`, virtual prefixes `shell: line 1`, with the same permission-denied cause.

All three have exact stdout/status/effects and differing stderr. This is an
observed diagnostic/profile distinction, not an invented exception or status
coercion. The packed non-S argument stays one literal argument. No registry
command is relabeled as a native builtin. These are still three strict losses.

### Five unchanged runtime/protocol losses — not env-S completion

- `split-errexit`, `split-assignment-and-clear`, `split-long-plus-option`, and
  `split-quoted-marker` remain126 at the unchanged runtime interpreter guard;
  native statuses are respectively1,1,0,1. Their output/effect losses remain raw.
- `non-s-packed-bash-option` remains126 versus native single-optional127; its
  stdout and effects match but status/diagnostic do not. This is the retained
  allowlist/single-optional protocol loss, not a split-parser pass.

The plain binding control passes. `src/shell/runtime.ts:1154` still recognizes
only plain `/usr/bin/env bash|sh` or its existing direct Bash forms. The core
commit does not change this dispatch, and this reviewer does not broaden it.
Actual Darwin kernel splitting controls remain distinct from the frozen
single-optional argv profile; no per-case OS oracle is substituted.

## Newly identified host-fixture API misuse

The only failing host is `literal-invoke-replace-env-parent`. Frozen
`hosts.mjs:25` calls:

```js
context.invoke('env', ['-S', '-i KEEP=${TOKEN} envcap "${TOKEN}" "\\$(not-evaluated)"'], {
  replaceEnv: true, env: { TOKEN: 'a b' }, stdin: new Uint8Array(), stdinIsDefault: false,
})
```

`CommandInvokeOptions.stdin` is **`ByteSource`**, not `Uint8Array`
(`src/contracts/command.ts:5`). `Runtime.invokeScoped` passes it directly to
`ShellInput` (`src/shell/runtime.ts:1353`), whose cursor requires
`source[Symbol.asyncIterator]()` (`src/shell/input.ts:14`). Even an empty
`Uint8Array` has no async iterator. The public `Shell.exec` convenience input
is a different API and does accept the byte arrays used by the other host.

**Observed:** child status1; frozen first assertion reports actual stdout
`parent:private`, expected `abcparent:private`. It throws before returning the
host's captures, middleware observations or complete shell result. Inner stderr
and inner status were not recorded and are not fabricated here. **Source-audit
inference:** this invalid stream input fails before the intended nested `env`
parsing, consistent with the missing command output. It is not evidence of a
new core parser, environment-replacement or injection bug.

This is an additional verifier fixture defect, discovered after the narrow
six-script `writeFile` correction. The prior statement that no analogous host
misuse was found was limited to its then-inspected file setup; this audit now
finds a distinct invoke-input misuse. Both earlier reports and this failed run
remain immutable. No host repair, assertion relaxation, product API widening,
new expected value, or retry is made. A valid combined literal/replaceEnv/parent
host control remains pending separately authorized fixture work. **Do not count
this host as green, and do not fix production to accept the invalid source.**

### Six passing unchanged host controls

- Exported-versus-local lookup: split expansion sees exported input only.
- Empty input origin: default and explicit empty `Shell.exec` inputs preserve
  distinct `stdinIsDefault` values.
- Nested command budget: the same shared budget rejects2 commands and admits3.
- Cancellation: original abort reason propagates; later rejection is observed.
- Awaited sink/output budget: asynchronous writes are awaited;7 bytes succeed,
  the6-byte limit rejects with the retained exact partial output assertion.
- Growth budget: expanded child argv is rejected under `maxExpansionBytes=4096`
  before the target callback receives the32768-character argument.

These are actual public `Shell`/registry controls, not stubs. No accepted
accounting/lifecycle suite is replayed or declared closed by this evidence.

## Independent source/capability audit

The source portion of the candidate commit adds `src/commands/env-split.ts` and
changes only the `env` definition/import in `src/commands/execution.ts` (including
the ordering of its null-output usage check). No runtime change is in this
commit. The following observations come from the committed source and frozen
holdouts, not the author's pass counts:

- `env-split.ts:46` tokenizes its own grammar without shell evaluation. Native
  exact rows cover quote fragments, escapes, comments, empty/unset arguments,
  variable boundaries, literal operators and malformed dollar forms. Injection
  marker/effect assertions are unchanged.
- `env-split.ts:100` looks up only own properties of the supplied incoming
  environment. `execution.ts:52` parses before clearing/unsetting/assigning the
  child map. Frozen lookup-order rows match native; values are appended as one
  argument fragment, not reparsed as shell syntax.
- `env-split.ts:130` uses a frame stack for repeated option reinsertion with one
  local parser-work object per env invocation, fixed byte/argument/re-expansion/
  work bounds and cooperative signal checks/yields. These local parser bounds
  do not reset the shell budget; unexecuted ceiling combinations are not passes.
- `execution.ts:85` uses literal `context.invoke` with `replaceEnv:true` and
  forwarded streams/origin. The real public Shell provides this route; its
  runtime nested invocation reuses `this.budget` at `runtime.ts:1330`. Shared
  command/output/growth limits are exercised by the six valid hosts.
- Parser errors check the signal before formatting diagnostics. No host process,
  fetch, ambient `process.env`, new shell, dependency or string-eval fallback is
  introduced by the two-file source change. Product process/fetch traps remain
  installed in all55 runs; all54 returned structured records report no attempts.
  The failing host has no returned trap record and is not overclaimed.

No genuine new core functional bug is established by these observations. This
does not accept the missing runtime feature, remove strict diagnostics, or close
the invalid combined host's unmeasured contract.

## Authentication, checks and cleanup

```text
candidate 84ab66ca717e0dff21abf57051b41cb553f3c7f3
src/commands/execution.ts SHA256
61940d3b86593243c13cab716be87f84647e42b69476757482dfebafc7d693a6
src/commands/env-split.ts SHA256
b005331bff0dd207a65b9001d235020f005eed45b813cca912851502c3f9dcf4
src/shell/runtime.ts SHA256 (unchanged)
2223ef9e02565d163ded042d933553a1efae502ce7531fe83bba5611d959c84b
```

Capture `2026-08-27T11:00:53.739Z`–`2026-08-27T11:01:11.983Z` uses the full
committed213-source-file archive plus four candidate manifests, all Git-blob
verified; actual broad `src/index.ts` and `agentCommands`, no live overlay or
narrow substitute. All34 original/history/setup-v2 files match their frozen
commit before and after. Actual helpers, parent drivers, native captures,
development-tool symlink target and source hashes are recorded independently.

All55 per-run guards pass: **11,165 actual module loads /55 public index loads**,
with before/load/after proofs. All318 development-tool identities remain stable.
Source/import guard validity is not a passing assertion. Live endpoints record
HEAD `a84dd195c13935587df0d53be85c86790a48e4d5`, with foreign work qualified rather
than claiming a clean current aggregate.

Compared with baselinee7f4f2e, the full candidate also includes intervening
changes to `package.json`, `src/commands/internal.ts`, `src/commands/network/body.ts`,
`src/commands/streams.ts`, `src/commands/structured/jq.ts`, `src/index.ts` and
`src/plugins/index.ts`. The raw `sourceChanges` inventory distinguishes these
from the author's two-source-file diff. No baseline-to-candidate improvement is
silently attributed to env alone; every imported dependency is from the full
candidate commit, not a latest-live overlay.

Both complete frozen native profiles and all four tool binary hashes are
reverified and retained: GNU env9.7 **Darwin** plus Bash5.3, and Apple env plus
Bash3.2. The48 current rows compare to the uniform frozen GNU primary; Apple
captures remain historical, not rebound to primary cwd/environment or selected
per row. **Zero native executions** in this phase. Exact paths/version captures
remain in frozen evidence; this is not a GNU/Linux env-order assertion.

Scoped TypeScript5.9.3 on the two changed env source roots and their dependency
closure: **status0,0 diagnostics,182 actual authenticated file reads**. The full
candidate tsconfig's strict options are retained with `noEmit`. This is not a
global typecheck or build. Two new driver syntax checks pass; new read-only
evidence-integrity tests **8/8 pass**, no skips. No original acceptance, benchmark,
kernel, private package, global build or other owner's suite is rerun.

One additional compiler child is separate from55 cohort executions. Cleanup
evidence binds the raw artifact hash, records all owned child groups absent,
and confirms removal of only this run's external archive after saving evidence.
Foreign staging/processes/scratch are untouched. Reproduction uses the one-shot
`core-candidate.mjs` in a disposable checkout without its two generated output
files; existing evidence must never be overwritten. Read-only validation is
`node --test tests/shell-stress/env-split-holdout/core-integrity.test.mjs`.

**Disposition:** frozen core review delivered with40/48 exact and6/7 hosts;
retain all eight raw losses and one fixture-invalid host. ROOT may route the
fixture defect separately. No source fix or expectation change is authorized
here. This leaf stops without waiting for a shebang decision. No full Bash,
native parity, full gate, lifecycle/creation-mask closure or superiority claim.
