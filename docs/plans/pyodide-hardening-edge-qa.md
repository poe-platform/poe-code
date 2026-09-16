# Pyodide hardening edge review

## Scope and execution

Review the current optional Python plugin as a user, preserving the existing
working tree. Read the package instructions, command/I/O/cancellation contracts,
and `packages/safe-bash/docs/pyodide.md`. Delegate independent command, worker,
and real-runtime reviews as required by the package instructions.

1. Run focused Python unit tests with worker/cache doubles.
2. Exercise the real pinned runtime separately: concurrent binary pipelines,
   capacity refusal, early consumer closure, cancellation during CPU execution,
   imports, startup and blocked I/O, descriptor cleanup and subsequent commands.
3. Run ordinary document/package workflows, including offline fresh-worker
   reconstruction, error/abort retry and native capability refusals.
4. Reproduce confirmed defects with failing tests before editing production code.
5. Run the maintained selected workspace build, typecheck and applicable lint.
   Record exact results and limits; do not claim universal edge-case coverage,
   hostile-code isolation, hard memory/CPU enforcement or release delivery.

## Confirmed defects

An environment commit could write a manifest exceeding `maxDownloadBytes` even
though every subsequent preparation rejects a manifest of that size. The new
regression failed with `Missing expected rejection`. Commit now checks encoded
manifest bytes before publication. The regression also verifies preservation of
the previous environment and a successful smaller commit afterward.

Downloaded URL metadata had the same asymmetry: large response headers could
produce a record accepted on first use but rejected on the next cached read.
A second failure-first regression now checks rejection before either cache
write, successful retry, and offline reuse of the corrected entry.

Synchronous endpoint failure during subscription still sent interpreter startup.
Startup now stops when subscription has already settled the invocation.

An empty-only async stdin producer could monopolize microtasks, preventing the
host's scheduled cancellation from running. The failure-first finite regression
exhausted 4096 empty fragments before cancellation. Input now yields every 128
pulls and inherits the caller's maintained checkpoint. Tests verify cancellation,
checkpoint failure, worker retirement and subsequent alias execution at capacity
one. These are host checkpoints, not cooperative Python awaits.

## Additional real-runtime coverage

- Two simultaneous binary producer/consumer pipelines occupy all four worker
  slots with one-byte shell pipe buffering and preserve every byte.
- Aborting a blocked command leaves its sibling operational and frees capacity.
- A continuously writing Python producer retires after `head` closes its pipe.
- A producer that writes once and then spins does not terminate merely because
  its consumer closes. An initial test expecting that behavior timed out; the
  pipe contract explicitly does not cancel the whole producer on reader closure.
  The corrected test requests caller cancellation after closure and verifies
  termination, descriptor cleanup and successful recovery.
- Additional worker doubles check Unicode startup output across three-byte
  transfers and native-hook refusal/loader restoration after startup failures.

## Results

Real-runtime tests remain outside unit discovery.
Focused Python/export units pass 144/144; SDK/CLI units pass 21/21. The maintained
selected `virtual-bash` build passes. The CLI's actual binary Python pipeline
compares all 262144 bytes and prints that count successfully. The help screenshot
was regenerated and inspected; trust and transfer/concurrency options are legible.

A full product-test attempt overlapped the screenshot command's implicit rebuild
and failed a byte-count assertion; its stderr was not captured by that assertion,
so the cause was not established. The assertion now reports command failure
before comparing bytes. Final real-runtime runs use the stable completed build.

Final real-runtime results: product worker 32/32, package/document provisioning
24/24, and launcher/public bundled SDK 26/26, all with zero skips. Total: 82/82.
The product suite verifies noncooperative CPU loops, startup, imports and blocked
stdin/stdout/stderr/filesystem cancellation separately from mocked unit tests.
Document checks include DOCX, XLSX and PDF creation/reopening, matching native
wheels, fresh-worker offline reuse and error/abort retry without subprocesses.
Maintained typecheck passes source/tests and all 26 public consumer groups;
expected negative fixtures are rejected.

Commands and local ephemeral logs:

| Check | Command / log |
| --- | --- |
| Python units | `node --import tsx --test packages/safe-bash/tests/commands/python/*.test.ts packages/safe-bash/tests/plugins/python-exports.test.ts`; `/tmp/pyodide-edge-unit-final.log` |
| SDK/CLI units | `npx vitest run src/sdk/bash.test.ts src/cli/commands/bash.test.ts`; `/tmp/pyodide-edge-sdk-cli-unit.log` |
| Real product | `node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/product-worker.test.mjs`; `/tmp/pyodide-product-user-edge-stable.log` |
| Documents | `node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/package-provisioning.test.mjs`; `/tmp/pyodide-edge-documents-final.log` |
| Launcher | `node --import tsx --test packages/safe-bash/tests/integration/pyodide-runtime/launcher.test.mjs`; `/tmp/pyodide-edge-launcher-final.log` |
| Build | `npm run build:workspaces -- --workspace=virtual-bash`; `/tmp/pyodide-edge-build.log` |
| Typecheck | `npm run typecheck --workspace=virtual-bash`; `/tmp/pyodide-edge-typecheck.log` |
| CLI screenshot | `npm run screenshot-poe-code -- bash --help`; `screenshots/bash-help.png` |

The initial full-root lint attempt reported zero code errors and 12 unrelated
unused-variable warnings, but exited 2 because the guarded filesystem identities
changed under `packages/safe-js` while the screenshot build ran. That is an
incomplete lint run, not a passing gate. A stable replay follows all builds.
The stable `npm run lint:eslint` replay passes (exit 0), with zero errors and
the same 12 unused-variable warnings in `.cache/pptx-usage-review/example.mts`.
Log: `/tmp/pyodide-edge-lint-stable.log`. No guard or lint rules were bypassed.

The documented trusted-Python boundary remains: empty JS globals and native
API refusals reduce accidental exposure, but workers do not prove confinement.
There are no demonstrated hard CPU/RSS/guest-heap quotas. Uncooperative host
promises can still delay cleanup; package expansion and external cache growth
remain host responsibilities. Browser deployment and every remote backend were
not requalified by this Node review. No commit, push or release was performed.
