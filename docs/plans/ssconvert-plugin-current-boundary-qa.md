# Current ssconvert registration boundary QA

Preserve the existing adapter/domain implementation and prior evidence. Do not
edit READMEs, stage, commit, push, publish, or add a native product dependency.

1. Authenticate the retained Gnumeric 1.12.61 archive under `out` against the
   requested SHA-256. Inspect the incomplete reference dependency/plugin/locale
   profile without promoting unavailable cells to passes.
2. Independently stress enrolled diagnostic output: reproduce a failing test
   before changing the adapter, including cancellation and cleanup ownership.
   Use original in-memory fixtures and injected byte capabilities only.
3. Exercise literal registration/collision/replacement, invalid raw argv bytes,
   invocation exports, default versus pipeline stdin, file budgets, cancellation,
   CLI/SDK comparisons and existing checkpoint/replay cases in current tests.
4. Run fresh domain workspace tests/lint, the uncached maintained safe-bash build
   closure, runner discovery tests, maintained filtered ssconvert command tests,
   guarded root ESLint and safe-bash typecheck. Investigate failures without
   bypassing admission guards; report incomplete gates separately.
5. Import the built public SDK/plugin and browser portable root. Measure startup
   separately from semantic checks, and retain explicit host opt-in if domain
   dependencies still justify it.
6. Capture virtual `ssconvert --help` using the screenshot tool and inspect the
   image. Keep temporary output under the task-owned `out` directory, record
   exact candidate source hashes/results, then purge only that temporary output.

For the realm check, create a separate `node:vm` realm with bytes
`[82, 69, 65, 76, 77]` and a one-cell workbook containing the number 17. Inject an
original codec returning that workbook. Use a host async iterable for Shell
stdin; require the command to return status 1, empty stdout and
`Unsupported workbook prototype\n`. Require SDK conversion to reject with code
`invalid-request`, exitCode 1 and the same diagnostic message, without output.
Explicitly copy the workbook into host plain records and Shell input into host
bytes; require command/SDK status 0, empty diagnostics and identical `17` bytes.
SDK source bytes may remain in the foreign realm in this measured case. Sending
foreign chunks directly to Shell stdin must reproduce status 1, empty stdout and
`shell: line 1: internal error\n`; record this as a limitation, not acceptance.
Without an injected transport, require an HTTPS input to return status 1, empty
stdout and `URI access capability disabled: https://denied.invalid/input\n`.

Public Node imports use `@poe-platform/safe-bash` and its literal
`/commands/ssconvert` export. The internal `dist/core.js` path is used only for
the sequential startup measurement; `/core` is not a public export. Capture help
from the public Shell with explicit plugin registration via `npm run screenshot`,
since the poe-code host CLI has no direct virtual-command dispatch entrypoint.

These checks qualify the command adapter's measured boundary behavior, not full
Gnumeric parity, deployed remote adapters or browser domain execution.
