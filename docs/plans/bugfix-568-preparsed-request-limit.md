# #568: Pre-parsed request body admission

## Validation and policy

September 4, 2026. Both `req.body` and the explicit internal `preParsed`
argument bypassed `maxBytes`: a 318-byte UTF-8 JSON request was accepted with
a 128-byte allowance, while the raw-stream route rejected it. Pre-parsed
batch-count admission already worked. No large allocation or timing claim is
needed to establish this defect.

When a byte limit is configured, serialize the selected pre-parsed body and
admit its UTF-8 JSON representation before classifying or dispatching messages.
Preserve explicit argument precedence, the raw-stream route, exact-boundary
acceptance, and the absence of an optional limit. This checks the representation
available here, not original wire whitespace/encoding; upstream middleware must
still bound its own input and allocations. Serialization is not incremental and
does not provide hard memory or CPU preemption for arbitrary host objects.

## TDD and scope

- Existing parser tests cover stream, `req.body`, and explicit input; requests,
  responses and batches; UTF-8 versus UTF-16 size; exact and insufficient bounds;
  explicit-input precedence; and the existing batch cap.
- A public `createHttpServer().handleRequest` regression supplies a pre-populated
  body, requires HTTP 413, and verifies no session ID was allocated.
- Before production changes, these checks produced three failures and three
  passing controls. Unselected tests are not counted as passing.
- An initial Express fixture did not establish body-parser execution in this
  repository's in-memory HTTP simulation. Its evidence is retained, but the
  attempted test was replaced with explicit public-transport coverage. No real
  Express deployment qualification is claimed, and the simulation was not changed.
- Owned implementation: `packages/tiny-http-mcp-server/src/parse-body.ts`.
  Tests remain in the two existing package test files. No README, release,
  transport-policy, runtime dependency, or stream-reader changes are required.

Logs: `/tmp/kamilio-568-validation.log`, `/tmp/kamilio-568-red.log`,
`/tmp/kamilio-568-red-express.log`, `/tmp/kamilio-568-final-red.log`.
Root build, full workspace tests, lint, push and release checks remain separate.

## Focused results

After the minimal production change, both affected suites passed 329/329 tests.
The full HTTP package directory then passed 398/398 tests in 14 files, uncached,
using Node 22.22.0 and the existing in-memory HTTP fixture. Counts overlap.
Logs: `/tmp/kamilio-568-green.log` and `/tmp/kamilio-568-package-tests.log`.
No actual Express middleware execution is claimed by the replacement test;
it supplies the body-parser output to the real public transport boundary.

Package-configured source-only no-emit typing has zero diagnostics. Including
the two existing test files reveals 17 diagnostics; an in-memory compiler-host
comparison against their immutable pre-change Git contents confirms the exact
same diagnostic file/code/message/source-span set, with no added diagnostics.
This is not a clean whole-test-tree typecheck. Evidence:
`/tmp/kamilio-568-types.log` and `/tmp/kamilio-568-types-compared.log`.

The main parser test file and this plan pass Prettier. The implementation and
production-readiness test file already differ from Prettier on the baseline;
their unrelated formatting is preserved. Owned-file `git diff --check` passes.
