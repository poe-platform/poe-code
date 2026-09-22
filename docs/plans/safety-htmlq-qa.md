# htmlq VFS resource and failure boundary QA

## Procedure

1. Run the private command's maintained unit and lint routes. Check explicit
   cancellation during input/serialization, producer return failures, foreign
   byte realms, owned node admission, hostile selectors and every resource
   ceiling. Independently verify output cancellation and repeated cleanup.
2. Run `tests/plugins/htmlq-boundaries.test.ts` against memory VFS. Execute an
   actual `.sh` file with a pipeline and redirect; compare literal bytes and
   typed SDK execution. Verify source symlink aliases, destination symlink
   rejection, existing/new output rollback, and conditional publication races.
3. Contrast stdout partial output and ordinary Shell redirect truncation with
   `-o` atomic publication. List VFS entries after failures to detect leftovers.
4. Deny fetch, supply explicit credential-like environment data, and attempt
   absent host/executable/URL filenames. Verify VFS errors, no network calls,
   no executable fallback, and preservation of inert script/javascript data.
5. Run the maintained Safe Bash runner checks, typecheck and selected workspace
   build closure. Stage the public artifact, install outside the checkout with
   private workspaces absent, execute the maintained htmlq runtime/type fixture,
   and inspect normalized CLI output in a screenshot.
6. Record exact candidate hashes and results below; remove task-owned output
   and installation artifacts after inspection. This is manual QA, not a
   scripted product QA command or a native upstream runtime integration.

## Findings

A failing independent control reproduced stdout cancellation leaking into
byte-only VFS file input: a preclosed stdout consumer rejected `-f in -o out`.
The fallback read was acquired through stdout. The fix awaits `readFile` with
the invocation signal directly; invocation task cleanup already waits for that
cooperative read. It retains the read byte ceiling, accounts the returned
allocation before parsing, and prevents output publication after cancellation.
A second control verifies that cleanup stays pending until an admitted delayed
read settles, then rejects cancellation without publishing the late bytes. Full upstream grammar/recovery parity,
actual browser/workerd/Bun runtimes, deployed remote VFS providers, performance
measurements and persistent checkpoint/replay are separate qualifications.

## Verification receipt — 2026-09-21

This is a dirty-working-tree candidate based on
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, not a committed revision.
The inherited htmlq implementation and publication wiring are preserved.
Task-owned changes are the independent Shell suite, four appended command
controls, one discovery assertion and the invocation-owned fallback read fix.
The prescribed package-pattern document was already moved to
`docs/plans/archive/safe-bash-command-package-pattern.md`; that existing copy
was followed without restoring or changing the unrelated move.

### Passes

- `npm run test:unit --workspace=safe-bash-command-htmlq`: 131 passes,
  zero failures/cancellations/skips. Existing controls include chunk-safe lossy
  UTF8/BOM boundaries, literal versus entity NUL, hostile selectors, inert
  raw HTML, lazy mutation, independent template content, every resource ledger,
  parser/serializer cancellation, cross-realm bytes, falsey producer/cleanup
  failures and original serialization invalidation.
- Final `tests/plugins/htmlq-boundaries.test.ts` via Node/tsx: seven passes,
  zero failures/cancellations/skips. Pipeline, redirect, VFS script, CLI/SDK,
  same-file/source symlink, destination symlink rejection, file rollback,
  stdout prefix, replacement/exclusive races, denied network/host paths and
  pending parse disposal all have literal expected results. No disk-writing
  unit fixtures, native utilities or LLM calls are used.
- `npm run test:runner --workspace=@poe-platform/safe-bash`: 563 passes,
  zero failures/cancellations/skips. Discovery explicitly includes the new test.
- Final `npm run lint --workspace=safe-bash-command-htmlq`: ESLint and both
  source/test TypeScript checks passed.
- Final `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`:
  maintained closure and guarded build/postbuild passed. Shared cache enabled;
  six cache hits reported. Final `dist/command.js` was inspected for the fixed
  invocation-owned read. This is not an uncached whole-repository build.
- `npm run lint:eslint`: complete, zero errors, four warnings, no cache hits,
  all 16,206 configured subjects processed. This repository run overlapped
  the final fix; the final private workspace lint separately covers that fix.
- Public packages were staged with `scripts/package-safe.mjs`, packed and
  installed outside the checkout with scripts/workspaces disabled. No private
  command package was installed or published. The maintained htmlq runtime
  fixture passed under default/browser/workerd Node conditions. All 29 copied
  command/Shell controls also passed against final installed exports, including
  the reproduced stdout/file-input regression and admitted-read cancellation.
  Copied controls changed only their imports to public subpaths.
- Strict NodeNext installed typechecking passed for the maintained htmlq type
  fixture and both copied boundary/control suites.
- Final installed engine bundled into a Node VM without process, Buffer or
  require passed cross-realm byte projection with fetch denied. Script text
  was preserved and no fetch occurred. An import scan of all 1,338 installed
  JS/declaration files found no bare private command/contracts specifiers.
- Final installed CLI screenshot inspected: retained-node/result blank lines,
  ordered attributes, status 0 and bounded `E_ARGUMENT`/status 2 were readable.
  The generic maintained screenshot route was used because this is an opt-in
  virtual Shell command, not a poe-code top-level command.

### Failures and incomplete qualification

- `npm run typecheck --workspace=@poe-platform/safe-bash` failed prerequisite
  admission before compilation: `resolvePeerProfile` in
  `tests/plugins/qualified-current-release/peer.mjs:245` requires the root
  `./safe-fs` export to import `./packages/safe-js/dist/safe-fs.js`; the current
  root manifest has no such export. This mismatch is concrete and does not
  disappear after the maintained build. The inherited root manifest and peer
  authority were not rewritten to make the gate green.
- The maintained source/test compiler stage
  `node scripts/historical-type-models.mjs --noEmit` failed with 736 diagnostics.
  Three were missing annotations in the new publication-race control; those
  were fixed and final installed strict typechecking passed. Remaining findings
  include removed `poe-code/safe-bash` public imports in retained consumer tests,
  filesystem metadata type drift, fmt's optional profile and SafeJS exact
  optional property errors. No successful rerun of this broad stage is claimed;
  focused installed checks do not replace it.
- Initial boundary runs exposed test-harness errors: nonexistent `fs.exists`,
  treating directory entries as strings and assuming memory VFS offered
  streaming publication instead of conditional byte mutation. These fixtures
  were corrected to the actual contracts. Output cancellation preserves the
  caller's abort reason, so that control was corrected to assert reason identity.
  The first screenshot used an incorrect packed dist path; the corrected final
  screenshot passed and was inspected. The genuine stdout/input boundary
  regression separately failed before the runtime fix.
- No completed `npm test`, repository-wide type gate or `npm run build` is
  claimed. Product changes are confined to one command; maintained selected
  workspace/build and explicit Shell checks establish this increment's scope.
  Actual browser/workerd/Bun engines, deployed remote VFS providers, full native
  grammar/recovery parity and performance measurements remain unverified.
  Node condition/VM checks do not certify those engines or sandbox trusted host
  JavaScript. Checkpoint/replay integration was not changed or qualified;
  original-source and mutation behavior are covered by the engine suite.

### Candidate binding and delivery

SHA256 of compact JSON of lexically sorted `[path, SHA256(bytes)]` pairs for
`packages/safe-bash-command-htmlq/package.json` plus non-test `src/*.ts`:
`b46714707b6b4baad08d6d52fc1317c1f91a82b585ba219c1e4ba329684b8e99`.
Final Shell suite: `44885b9f53dbba50b3575fdc0852e248b6581893fd9b0c45db82facc850d3b5a`.
Final command suite: `c637ad345d1e5008440f32e8de5668ea69c22c82ed7a0ae8e710c8b97a8ff954`.
Final public Safe Bash tarball (`0.0.0-safety-htmlq-final`):
`643c3880ac0d1867ab2ef2267ab16ba43f012828b60500ec1e62556d5c8b306e`.
Cases are deterministic hand-authored fixtures, not generated/performance cohorts.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No standalone private publication was performed or authorized. Task-owned
logs, tarballs, staged artifacts, screenshots and external consumer installation
were removed after this durable receipt was recorded. Shared type gate failures
remain open; this is scoped boundary verification, not a clean broad gate.
