# Pyodide runtime hardening

## Scope

Harden the existing optional Python command against scheduling deadlocks,
unbounded bridge/cache retention, cancellation races and accidental ambient JS
exposure. Preserve canonical filesystem access and ordinary document libraries.
No host isolation or hard interpreter CPU/RSS guarantee is implied by workers.

## Ownership

- Runtime worker, admission, streams and fast regressions: runtime agent.
- Real pinned runtime interruption and concurrent execution: qualification agent.
- Package-cache lifetime, trust/native inventory and contracts: boundaries agent.
- SDK/CLI integration and final checks: root.

## Validation

Add regressions before fixes. Keep actual Pyodide cases outside unit discovery.
Run focused Python units, SDK/CLI units, selected workspace build, maintained
source/public consumer typechecks, applicable lint and a CLI help screenshot.
Validate CPU loops without cooperative awaits; cancellation during startup,
imports and blocked canonical I/O; binary producer/consumer pipes; interpreter
isolation; descriptor and worker retirement; subsequent successful execution.

Initial SDK/CLI regressions failed on missing trusted-code forwarding/admission,
missing concurrency/input flags and missing package-cache bound flag. They pass
after integration changes. Runtime and cache regression evidence and final
commands/results will be appended after verification.

## Executed evidence

- SDK/CLI: 21 focused Vitest checks passed after failure-first trust forwarding,
  explicit admission and option-parity regressions.
- Initial runtime/worker changes: 36 unit checks passed; reproduced missing
  capacity admission, oversized retained stdin acceptance, ambient JS startup
  globals and missing Node trust guard before fixes.
- Cache: eight failure-first regressions cover eviction, session lifetime,
  concurrent open rejection, failed reads, late retirement, manifest retention,
  empty-body fragments and oversized external metadata.
- Root TypeScript build configuration and maintained safe-bash source/public
  consumer typecheck passed after stable build. Earlier typecheck/runtime runs
  overlapped screenshot's implicit predev build and were invalidated by deleted
  dist files; those runs are not acceptance evidence.
- `npm run screenshot-poe-code -- bash --help` passed and the generated
  `screenshots/bash-help.png` was inspected. Trust and budget options are readable.
- Native runtime regression found `os.system('exit 73')` returned 18688 by invoking
  the host shell. Probe used only the shell exit builtin. This is an actual product
  defect, not an unsupported-operation pass; native interception is required.

Working-tree evidence only. No commit, remote delivery or release is claimed.

## Native call correction and final focused results

The pinned runtime's Wasm imports now refuse process and socket operations before
interpreter creation; startup fails if the expected import ABI is not observed.
Both `os.system` and `ctypes.CDLL(None).system` return libc failure (-1), and
socket creation refuses. Direct host filesystem/socket helpers and obvious
private aliases are disabled. Guest package loading is disabled after explicit
provisioning. Empty `jsglobals` and these refusals are defense against accidental
host exposure; reflective JavaScript access remains trusted-code-only.

- Python command/provisioning/worker/export units: 136/136 passed.
- SDK/CLI Vitest: 21/21 passed.
- Real product worker: 28/28 passed; additional targeted reruns cover the final
  direct native aliases, helper diagnostics and initialization marker ordering.
- Real package/document provisioning after native guards: 24/24 passed, including
  document artifact round trips, offline fresh-worker reuse and abort/retry.
- Final selected `virtual-bash` workspace build passed. An initial compile failure
  from DOM-only WebAssembly type names was fixed with local structural types;
  runtime behavior was unchanged. Four overly broad unit-test Function casts
  found by focused lint were replaced with precise signatures.

The default concurrency bound is per command/plugin factory, not global across
independent plugin instances. External cache retention remains the host's policy.
No worker pool/reset mechanism is used: every invocation gets a fresh worker and
interpreter, and admitted capacity is released only after successful cleanup.

Final compiled launcher: 26/26 passed after the final build. The three explicit
real-runtime suites total 78/78 with no skips. Focused ESLint on every edited
source/test file and root `tsconfig.build.json` typecheck both pass. Runtime logs:
`/tmp/pyodide-product-final.log`, `/tmp/pyodide-documents-native-final.log`,
`/tmp/pyodide-launcher-final-built.log`; unit log:
`/tmp/pyodide-hardening-unit-final.log`. These are local ephemeral captures.

Final maintained safe-bash typecheck passed: source/tests plus all 26 current
consumer groups, with the expected negative type fixtures rejected. Final
repository-wide `npm run lint:eslint` passed with zero errors and 12 warnings
in an unrelated `.cache/pptx-usage-review/example.mts` file. No unrelated files
were changed. All intended focused validation is complete.
