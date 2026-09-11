# #667: owned positional getopts validation

## Status and scope

Implemented and frozen for root integration September 8, 2026, following the
root-reported `9b791fa88` delivery. Root owns inventory registration, Git,
build, lint, broad gates and delivery. This change does not reopen #657,
#663, #664 or another worker's fixes.

Owned files:

- `packages/safe-bash/src/shell/getopts.ts`
- `packages/safe-bash/src/shell/runtime.ts`
- `packages/safe-bash/src/shell/arrays/state.ts` (additional ownership granted)
- `packages/safe-bash/tests/shell/getopts-validation.test.ts`
- This plan.

## Validated defect and RED

Repeated getopts calls previously revalidated every positional argument in
both the runtime admission loop and scanner. No OOM or elapsed-time claim
is needed: bounded synthetic strings expose quadratic work directly.

At N = 16, 32, 64, 128, scanner-only checkpoint charges were:

- Separate `-a` arguments: 884, 3300, 12740, 50052, or `(N+1)(3N+4)`.
- One clustered argument: 374, 1254, 4550, 17286, or `(N+1)(N+6)`.

Fresh canonical tests ran before production edits: 26 tests, 13 failures and
13 passing compatibility controls. Strengthening the canonical tests before
production edits produced 27 tests, 14 failures and 13 passes. Pass-through
instrumentation inside the real runtime getopts builtin additionally measured:

| Input | Counter | N16 | N32 | N64 | N128 |
| --- | --- | ---: | ---: | ---: | ---: |
| Separate | charCodeAt calls | 611 | 2243 | 8579 | 33539 |
| Separate | positional bytes admitted | 544 | 2112 | 8320 | 33024 |
| Separate | indexed positional reads | 576 | 2176 | 8448 | 33280 |
| Clustered | charCodeAt calls | 356 | 1220 | 4484 | 17156 |
| Clustered | positional bytes admitted | 289 | 1089 | 4225 | 16641 |
| Clustered | indexed positional reads | 81 | 161 | 321 | 641 |

A further snapshot-cancellation test failed against the synchronous draft:
copying reached commit without the requested checkpoint/abort observation.
The final implementation checkpoints before indexed reads and releases an
uncommitted reservation on failure, preserving the falsey abort reason.

## Minimal implementation and ownership

The scanner accepts either its existing raw array input or a module-branded,
frozen owned snapshot. A WeakMap attaches only validated argv byte counts to
the owned input. Raw arrays and forged shapes never acquire a validation
receipt; malformed trailing arguments still fail before a cursor result.
Only successful, uncancelled completion publishes a receipt.

Specifications are validated and compiled on every call. The final design
deliberately does **not** retain a spec string or compiled table: the earlier
unapplied draft's spec memo could outlive command-owned accounting. Spec
changes, diagnostic flags and limits therefore retain their current-call
checks without another invalidation mechanism. Warm owned scans check argv
count, cached UTF-8 byte totals, current specification bytes, step caps and
abort state before returning a transition.

Runtime caching applies only to implicit positionals, not fresh explicit
command argv. StateMonitor owns one snapshot and its allocation scope for the
current positional revision. Replacement, shift, function/source argument
publication or restoration, and tracked same-array mutations invalidate the
cache and close its reservation. State cleanup also clears the owner and
closes the reservation, retaining #664's cleanup retirement ordering. A
post-validation revision check prevents publication from stale positionals.
No cache is copied into cloned monitors.

Snapshot storage reserves an estimated `256 + 8*N` bytes and `N + 2` slots
before indexed copying, plus the existing ValueScope enrollment of 64 bytes
and one slot. Copying charges one work step per argument and checkpoints at
the runtime's existing 128-step cadence. The snapshot copies string
references, not payload bytes; those immutable strings remain owned by the
same positional state. Unpublished scopes close in finally. Warm retrieval
uses the existing snapshot directly: no per-call slice, spread or vector copy.

There is no strong global registry of old argv or specifications. Weak memo
keys cannot independently keep an input alive. The deterministic ownership
test checks reservation close, owner clearing and zero arena usage after
execution rather than making GC/WeakRef or whole-process heap claims.

## Compatibility and qualification

- Existing command/context admission, flags, raw/explicit argv checks,
  OPTIND/cursor behavior, diagnostics and destination publication remain.
- Tests retain replace/shift, spec changes, function/source restoration,
  explicit argv changes, malformed trailing data without cursor publication,
  UTF-8 caps and falsey cancellation cases.
- Cache admission is optional: if current arena headroom cannot cover the
  snapshot, runtime retains the existing raw-validation path rather than
  throwing a new admission error. Existing 64/128/256/512-byte successful
  scripts remain successful.
- An admitted cache genuinely consumes budget until invalidation/close.
  This does not establish unchanged headroom for every later near-limit loop
  body. The low-headroom fallback and raw/explicit paths still revalidate;
  linearity is qualified to the admitted, unchanged owned positional path.
- This is not arbitrary host-JavaScript sandboxing, a GC/RSS bound, a native
  fallback, or a blanket weakening of error/diagnostic assertions.

## Focused validation

Node v22.22.0 from `/tmp/kamilio-toolchain.path`, `TSX_DISABLE_CACHE=1`,
`NO_COLOR` unset, and `TMPDIR` set to the validation base's `tmp` directory.
Tests use the maintained `scripts/test-reporting.mjs` reporter and `--import
tsx`, from the safe-bash package directory. New filesystem fixtures use
MemoryFS only; no fixture files are written to disk.

Dedicated GREEN: **28/28**, no failures, cancellations or skips. Total owned
scanner-plus-snapshot work now measures `8*N+4` for separate arguments
(132, 260, 516, 1028) and `5*N+7` for clusters (87, 167, 327, 647).

| Input | Counter | N16 | N32 | N64 | N128 |
| --- | --- | ---: | ---: | ---: | ---: |
| Separate | charCodeAt calls | 99 | 195 | 387 | 771 |
| Separate | positional bytes admitted | 32 | 64 | 128 | 256 |
| Separate | indexed positional reads | 16 | 32 | 64 | 128 |
| Clustered | charCodeAt calls | 84 | 164 | 324 | 644 |
| Clustered | positional bytes admitted | 17 | 33 | 65 | 129 |
| Clustered | indexed positional reads | 1 | 1 | 1 | 1 |

Adjacent GREEN, each file executed directly with Node/tsx and the maintained
reporter to obtain case counts:

- `getopts/scanner.test.ts`: 49/49.
- `getopts/work.test.ts`: 48/48.
- `getopts/runtime/state.test.ts`: 34/34.
- `getopts/runtime/ordering.test.ts`: 39/39.
- `getopts/runtime/host.test.ts`: 27/27.
- `cleanup-retention.test.ts`: 18/18.
- `value-state.test.ts`: 37/37.

Adjacent total: **252/252**. With the dedicated regression: **280/280**,
zero failures, cancellations or skips. The earlier eight-file aggregate
invocation reported eight file-level passes; those are not added to the case
total. All owned sessions finished. Source, tests and plan are frozen for
root integration; no leaf build, lint, full suite or Git operation was run.

## Root delivery qualification

September 8, 2026: root committed the candidate as `f667f5d76` and ran the
following uncached checks with source and tests frozen. Evidence directory:
`/tmp/kamilio-667-gate.gFWzPl`.

- Maintained selected build closure:
  `npm run build:workspaces -- --workspace=virtual-bash`, exit 0; SafeFS and
  SafeBash built from workspace declarations.
- Maintained `npm run test:runner --workspace=virtual-bash`: 282/282 pass.
- Current maintained discovery selected all 108 `tests/shell/` files:
  3,638/3,638 pass, no failures, cancellations or skips. This is a complete
  shell selection, not a claim of a full repository or full package test run.
- Built public exports, with the standard-command plugin registered, matched
  native Bash for 2,000 separate options (`2000:2001`) and a 2,000-option cluster
  (`2000:2`), including exact stdout, stderr and exit status. The initial smoke
  fixture omitted that plugin and failed with `printf: command not found`;
  its separate log is retained, not counted as a product failure or a pass.
- Exclusive guarded root `npm run lint`: exit 0, including ESLint, root type
  checking and workflow lint. No other owned writer or test process ran during
  that lint invocation.

The change has no intended visual CLI changes. These checks do not assert
wall-clock, RSS or arbitrary near-limit headroom guarantees. Remote delivery
and release publication are verified separately after the push.
