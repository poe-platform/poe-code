# Supported public SafeJS boundary — August 27, 2026 UTC

Author checkpoint for a different reviewer, not self-acceptance or a whole-engine
gate. The earlier four raw-engine blocker categories are not four demonstrated
product defects. This follow-up exercises the actual copied engine through a
clean built, packed and offline-installed public `virtual-bash` package.

## Frozen results

Actual engine throughout: `bb23ec270aaaf1d394b00d330fbf1aa6ccb2952e`,
`@poe-code/safejs@0.0.1`; Node22.22.2, TypeScript5.9.3, Darwin arm64.

| Product revision | Cohort | Pass | Fail | Skip |
| --- | --- | ---: | ---: | ---: |
| `b4cde0bf2694c353222e21ebd8f49eeae329401e` | Public baseline | 24 | 2 | 0 |
| `866a6a58eb19d7a4271fb924ec4dd103c813d0a5` | Unchanged public cases, source fix | 26 | 0 | 0 |
| `034a5f0819ed4e06d7035c77340a066eb7121b37` | Unchanged public cases, repeat | 26 | 0 | 0 |
| `034a5f0` | Conventional command/stress | 116 | 0 | 0 |
| `034a5f0` | Existing bridges | 28 | 0 | 0 |
| `034a5f0` | Original nine desired cases | 8 | 1 | 0 |
| `034a5f0` | Separate raw action-abort | 0 | 1 | 0 |
| `034a5f0` | Proposal supplementary invariants | 2 | 7 | 0 |
| `034a5f0` | Unapproved reason profile | 0 | 18 | 0 |
| `034a5f0` | No-engine conventional/bridges | 82 | 0 | 62 |

The public fixture files have identical hashes at baseline, fixed and repeat.
The fixed/repeat installed tarball is byte-identical:
`d5119e405c5af202aedc7185f96a577ee75af6dcd226207d7833f6dad0bc77ed`.
Fixed capture: `2026-08-27T04:49:07.492Z–04:49:18.858Z`.
Final conventional capture: `04:50:50.700Z–04:51:10.374Z`; public repeat:
`04:51:10.407Z–04:51:21.837Z`, all August 27 UTC.

The116 conventional passes comprise53 actual-engine behaviors,60 fixture/config
cases, one structural type probe and **two defect characterizations**. The28
bridge passes comprise five actual-engine behaviors,22 fixture/config cases and
one structural type probe. Neither characterizations nor62 unavailable-engine
skips are promoted to successful guest execution. These overlapping cohorts are
not added into a unique product coverage score.

Exact per-case failures, versions, hashes and capture logs are preserved in
[CHECKPOINT.json](../public-evidence/CHECKPOINT.json) and the linked
`baseline/`, `fixed/`, `repeat/` and `conventional/` reports. Historical evidence
under `../evidence/` remains unchanged. Three empty build stdout files acquire a
trailing newline during archival; [ARTIFACTS.json](../public-evidence/ARTIFACTS.json)
records captured and archived hashes. Behavioral logs are unchanged.

## One reproduced product cause, two failing recipes

The public command environment lost a literal own `__proto__` key:

- Direct command: actual `[null,"ctor","proto","ok"]\n`, expected
  `["literal","ctor","proto","ok"]\n`.
- Actual shell pipeline: actual `/work:undefined:é😀`, expected
  `/work:literal:é😀`.

Source commit `866a6a5` builds `command.env` as a null-prototype own-entry string
dictionary instead of an ordinary object. This preserves literal `__proto__`,
`constructor` and `prototype` data without mutating the caller or exposing an
Object-prototype capability. It changes neither the engine nor signal, reason,
budget or capability identity rules. Both unchanged public recipes now pass.
Focused command/lifecycle/safety tests pass54/54, zero skips; the frozen packed
gate also covers the actual Shell, not only a stub invoker.

Separate test-only commit `034a5f0` corrects exactly eight proven stale constructor/
Array-static/thrown-Error assertions against current engine behavior. Signalled
and unsignalled controls remain. The original failures and the justification are
preserved in [STALE_TEST_DELTA.md](../public-evidence/STALE_TEST_DELTA.md).
This is not eight production fixes or a blanket expected-output refresh.

## Cancellation and reason boundaries

All six public abort-and-late-reject child routes pass before and after the fix:
command FS, stdin, stdout, console, standalone FS module and standalone shell
module. Each runs with `--unhandled-rejections=strict`, synchronously aborts from
host work, returns a rejected promise, waits40ms, asserts one host call and no
later file effect. The stdin case also checks iterator closure. Signals are
explicitly propagated, not removed to avoid an engine defect.

- Four command routes preserve the exact original cancellation reason object.
- Standalone FS/shell modules invoked through raw engine `run` preserve the
  cancellation message but **not** raw Error object identity.
- Direct bridge pre-abort deliberately returns its established sanitized
  `AbortError`/`ABORT_ERR`, without private reason/cause leakage. This is not a
  promise of raw identity and is tested separately from command behavior.
- Command pre-abort preserves exact Error, record, null and false reasons with
  zero runtime or I/O calls. Its existing entry/final checks protect this boundary.

Existing deferred/observed bridge and serialized stdio operations prevent the
raw action-abort race in these measured routes. This does not establish safe
cancellation for arbitrary host callbacks or forcibly cancel uncooperative work.

## Capability data, quotas and supported workflows

The public cases preserve JSON text containing own special keys, directory names
including `__proto__`, stat/dirent predicates and binary file size. Shell env
data reaches the executor; shell result projection remains exactly stdout,
stderr and exitCode rather than exposing extra host result capabilities.

A16KiB command data budget rejects32KiB returned VFS text with status124, one
read and no later write, including attempted guest recovery. Retained command
FS/stdio/exit capabilities are invalidated after completion. Finite FS data and
predicate metadata fit an explicit ample budget without reset. Existing actual
engine cohorts cover byte I/O, pipes/env/cwd, readonly permissions, fatal quotas,
host-call policy and reconciliation refusal for pending effectful shell replay.
This is not durable exactly-once replay or every backend's acceptance.

No additional public failure was reproduced in these supported budget/capability
cases. Low-level retained-graph helper measurements are not proof of end-to-end
safety undercharge; conservative overcount is a separate issue.

## External constraints, not silently waived product failures

At engine `bb23ec2`, the raw pure-run pre-abort case and arbitrary raw host
action-abort child still fail. Ordinary-record special-key wrapping and generic
branded/retained graph helper cases also remain in the separate raw cohorts.
The proposed18-case reason contract is unapproved, not18 demonstrated product
defects. No generic engine wrapper or private patch is applied.

If a future integration needs those raw surfaces, minimal upstream work is:

1. `packages/safejs/src/interp/host-bridge.ts`: observe the supplied original
   promise even when cancellation wins before host-result observation. Preserve
   rejection/abort semantics and prove no unhandled rejection in a strict child.
2. `packages/safejs/src/interp/cancel.ts`: preserve own special-name data without
   prototype setters; retain graph identity/metadata without fabricated quotas.
3. `packages/safejs/src/run.ts`: decide and test raw pre-abort/reason semantics
   before initialization. Exact reason identity and a proposed shaped envelope
   cannot both be asserted without a clear contract.

Those are current-commit-targeted requirements, not approval of `0c1bfe2` or a
request to reimplement the engine inside this product. Remaining supported
public failures in the26-case cohort: **zero after the dictionary fix**, pending
different-reviewer verification. Raw-engine limitations remain explicitly open.

## Isolation, typing and reviewer reproduction

All runs build/package in isolated regular-file trees, load the copied actual
engine and installed public package, and reject private/product-source fallback.
Package runtime dependencies remain empty. Before/after private HEAD, status,
index, selected metadata and copied engine hashes match; temporary execution
trees are removed. No private install, build, source change or proposal application
occurs. The committed snapshots exclude concurrent unrelated product edits.

Product builds pass. Paired strict public-consumer checks report111 baseline and
111 integration diagnostics, **zero introduced**; the deliberately isolated
engine config retains eight missing workspace declaration/related diagnostics.
This is not a clean standalone engine typecheck. Focused changed-test typing
passes; no competing whole-product suite was rerun.

Reproduce from the repository with a fresh outside evidence directory:

```sh
node tests/integration/safejs-current-20260827/run.mjs \
  /Users/kjopek/Workspace/poe-code /tmp/NEW_SAFEJS_PUBLIC_REVIEW public-boundary
```

Omit `public-boundary` for conventional plus explicit raw/proposal/no-engine
cohorts. The runner freezes the current committed product HEAD and records it;
its successful capture exit does not mean all raw probes pass. Review `report.json`.
Review source `866a6a5`, test-only `034a5f0`, unchanged public fixture hashes and
the intentional command-versus-bridge reason distinction. Different-reviewer
acceptance, broad integration and the overall project goal remain outstanding.
