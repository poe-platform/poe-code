# Read-only output-budget investigation — 2026-08-27

Source freeze retained. No repository writes, checkouts, stash/reset, commits,
contract changes or independent fixture edits. Inspected current HEAD d8a1acd;
shell integration remains 954f2302e4b2f42f90cb5ffd5670d1936f47390c.

## Finding

Confirmed pre-existing transparent sink double-accounting, not a replaceEnv
regression. Runtime.invoke wraps explicitly supplied stdout/stderr even when
they are exactly the already-budgeted current context sinks. Omitting the same
sink options avoids that extra charge. All three replaceEnv settings produce
the identical accounting observations on both current and pre954 runtimes.

Frozen evidence read: tests/shell-stress/env-replacement/PREPARATION.md and
product.mjs:70. The independent witness registers tick, then starts env -i tick;
tick writes four bytes and recursively invokes itself without sink overrides.
Its two calls/four visible bytes are reproduced. The initial env invocation,
not the recursion or replacement flag, adds the extra budget wrapper.

## Static call chain

- src/shell/shell.ts:75: Shell.exec creates budget.sink around Capture and its
  optional external observer. These two deliveries already count only once.
- src/commands/execution.ts:78: env invokes the child with stdout=context.stdout
  and stderr=context.stderr (plus approved replacement/cwd/stdin fields).
- src/shell/runtime.ts:1276: every truthy options.stdout is wrapped again by
  this.budget.sink; line1277 does the same for stderr. No identity/ownership test.
- src/shell/runtime.ts:81: each wrapper independently checks the same Budget.bytes,
  increments by chunk.byteLength, then forwards to its downstream sink.
- Consequently a four-byte write under env consumes eight budget units. At
  limit10 the next tick is dispatched, but its four-byte write fails before
  reaching Capture. Three wrappers reject the first four-byte write after two
  inner accounting steps, leaving zero visible bytes.
- Pipeline destinations are separate: runtime.ts:332 budgets pipe output;
  the downstream command writes to its own output destination. signalSink at
  runtime.ts:218 does not itself increment bytes. A real pipeline transfer can
  therefore cost twice the final visible bytes even without duplicate wrappers.

## Bounded actual-Shell controls

Each row ran under omitted, false and true replaceEnv, on BOTH runtimes:
54 total actual Shell+agentCommands observations. Limit10, four-byte payload.
Results below are dispatches of registered tick / external visible byte count.

| Route | Both runtimes / all flags | Result |
| --- | --- | --- |
| Three direct registry commands | 3 / 8 | ShellLimitError(maxOutputBytes) |
| Once-invoked, sinks omitted | 3 / 8 | same typed error |
| Once-invoked, exact sinks explicitly forwarded | 2 / 4 | same typed error |
| Nested invocation, sinks omitted | 3 / 8 | same typed error |
| Nested invocation, exact sinks explicitly forwarded | 1 / 0 | same typed error |
| Recursive tick, sinks omitted | 3 / 8 | same typed error |
| env -i recursive tick | 2 / 4 | same typed error |
| tick piped to registered byte forwarder | 1 / 4 | success |
| env -i tick piped to same forwarder | 1 / 0 | same typed error |

All stderr is empty: these are not missing-command or diagnostic-overflow
false positives. Raw output, hex bytes, counters and full error name/message/
limit/stack remain in /tmp/safe-bash-env-output-current.json and
/tmp/safe-bash-env-output-baseline.json. Stack layout differs naturally because
the old runtime is independently transpiled; no raw evidence was normalized.

Probe: /tmp/safe-bash-env-output-probe.mjs. Each profile child had a12-second
hard deadline and1MiB output bound, detached process-group cleanup; both exited0
well within the deadline. Native shell/coreutils cohorts were not run.

Baseline isolation: git show 954f230^:src/shell/runtime.ts supplied precisely
the old runtime (SHA256 e886b64536c7496769fdbe856aafb0e73ee88ace47c2a3ca9cb3cc71f11f8c4a).
Existing TypeScript transpileModule produced /tmp/safe-bash-env-output-baseline-runtime.mjs.
A /tmp Node load hook substituted only that runtime module at its original
URL; shell, contracts and core imports remained current real repository TS.
No product process spawning was added and no repository file was replaced.
The worktree hash recorded by that probe remains the current file hash; it is
not mislabeled as the loaded old runtime. The loader and original git source
identify the baseline independently.

## Contract interpretation / routed question

src/contracts/command.md:15 requires unchanged shared execution/output/depth
budgets and stdout/stderr transfer; :3 preserves absent/false environment merge
and PWD behavior. src/shell/types.ts:18 declares maxOutputBytes without defining
its counting unit. No inspected public contract/README defines total output as
only final visible bytes, or explicitly authorizes repeated charging of one
transparent forwarding operation. Actual implementation counts budgeted write
boundaries before downstream success, not simply delivered bytes.

The frozen expected3calls/8bytes is supported by direct and implicit-invoke
controls. Its broader phrase "delivered bytes count once" must not imply that
real producer+consumer pipeline output is globally counted once. Do not waive
the frozen failure, blame replaceEnv, or change the environment contract.

Exact clarification for root/Curie: should transparently forwarding an existing
context output sink preserve the same accounting as omitting that override,
while distinct pipe/file/capture destination writes remain separately charged
and downstream-failing writes retain existing precharge behavior? I recommend
yes, routed as a separate pre-existing runtime-accounting correction. This
does not require a public API/dependency expansion.

## Minimal proposed follow-up — NOT IMPLEMENTED

Start at Runtime.invoke:1276-1277: reuse an explicitly supplied sink that is
the identical contextual sink instead of adding another Budget.sink wrapper.
Continue budgeting genuinely new external sinks; preserve original cancellation
and all budget ownership. This minimal identity case fixes the demonstrated
env/direct-forwarding discrepancy without changing false/omitted environment
semantics. A broader same-Budget ownership mechanism would need separate care
for cross stdout/stderr aliases and signal-only wrappers; do not blindly unwrap
arbitrary host wrappers or deduplicate chunks by buffer identity/content.

Proposed regressions: exact current54 matrix; stdout/stderr forwarding and
cross-descriptor aliases; genuinely new supplied sinks; nested middleware;
repeated writes reusing the same Uint8Array still charged each time; real
pipeline stage writes remain charged; cancellation identity/late rejections;
typed exhaustion before further sink effects. Preserve independent expectations.

## Unchanged ready hashes / closure

runtime.ts 7aaaaff3ebc18c65556036878e48a4977b55bc2689adfc647c20be663f3cdd42
shell.ts 4ac91162195c150848793c92b8b1e90f15a36e67b5ae8a2652fe7ed9dcf4fb5e
types.ts fc4133f1fb41283b0586aa7597c766d393d4f91067b613f4777e5adbef230a6d
contract command.ts 1ec2f2907eb123ea366623bda293249a62bad6886a63bebb957930df0d414ffa
core execution.ts 1d084ab203dc59a510e39e5c71743b755ba9bdb5d4b018658398ed96c3dff700

Owned children stopped; no watchers/SIGSTOP. No old9/custom5/BOM/jq/expanded/
current-shell/native reruns. Independent native14/15 order observation remains
separate and unchanged. Source lease remains frozen; no correction authorized
or implemented by this investigation.
