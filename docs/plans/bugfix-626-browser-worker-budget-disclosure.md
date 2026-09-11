# Issue 626: disclose browser worker resource limits

Author: kamilio. Status: validated and implemented; delivery checks in progress.

## Exact requested scope

The issue explicitly suggests documenting that browser regex/ERE workers rely
on protocol budgets. A watchdog or smaller browser ceilings are optional, not
required fixes. Do not reinterpret this documentation request as a requirement
to invent a browser equivalent of Node's hard heap/stack settings.

Current `src/engine/workers.mjs` forwards `workerData` into its bootstrap and
creates a native browser Worker with a name, but does not enforce the pinned
engine's Node `resourceLimits`. Earlier six tiny shim controls verified this
data flow and ordinary message/error/termination behavior. They did not execute
a browser OOM or establish that every OOM leaves the page alive.

## Change

- Add an accurate warning to the existing playground `help` output: regex/ERE
  workers use protocol work/byte ceilings and timeouts, not Node heap/stack caps.
- Document the boundary outside README files, including that browser-level
  resource exhaustion and page survival are not guaranteed by worker errors.
- Keep the pinned `poe-code@14.0.4` engine and current worker behavior unchanged.
- Do not present asynchronous memory measurement as an allocation-admission cap.
- Keep moving engine execution off the page in separate issue 627.

## Validation and delivery

First add a failing help-output assertion, then change the copy. Run the
maintained playground unit/build checks and appropriate guarded root lint.
Inspect the rendered help in a real browser screenshot; do not claim OOM
containment from a mock or screenshot. Pull with rebase, verify the pushed main
commit, close issue 626 immediately, and monitor publication separately.

## Executed validation

- Fresh help regression failed on the missing worker-budget disclosure before
  changing production copy.
- Maintained playground unit route: 148 tests across six files passed.
- Maintained playground build: TypeScript and production site build passed.
- Guarded repository lint, root TypeScript checking, and workflow lint passed.
- Rendered production help in an isolated browser session; inspected screenshots
  of the full command and resource-limit section. All three warning lines are
  readable, and the command finishes successfully. Closed the owned session and
  verified it is absent from the session list.
- No engine behavior, package pin, or worker resource policy changed. No browser
  OOM experiment or universal page-survival claim was made.
