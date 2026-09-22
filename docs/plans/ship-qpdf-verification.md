# ship-qpdf verification

Inspected on 2026-09-21 at HEAD
`ab1fa8d34101e1e7f61272973f3bc28a842043d8`, including the preserved working
tree. Shipping qualification remains **blocked by missing implementation**.
Pinned-source native controls are compatibility research, not product acceptance.

## Executed current-candidate checks

| Boundary | Evidence | Result |
| --- | --- | --- |
| Private command | Node filesystem checks | `packages/safe-bash-command-qpdf` absent |
| Composition | Node filesystem checks | `packages/safe-bash/src/commands/qpdf/index.ts` absent |
| Built runtime/types | Node filesystem checks | `packages/safe-bash/dist/commands/qpdf/index.js` and `index.d.ts` absent |
| Manifest | Node JSON parsing of safe-bash manifest | No `./commands/qpdf` export, command development dependency or private-workspace profile |
| Default import | Node ESM dynamic import of `@poe-platform/safe-bash/commands/qpdf` | `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| Conditional imports | Separate Node invocations with `--conditions=browser` and `--conditions=workerd` | Both `ERR_PACKAGE_PATH_NOT_EXPORTED` |
| Resolution control | Node ESM `import.meta.resolve` | Existing `@poe-platform/safe-bash/contracts/command` resolves to checkout `dist/contracts/command.js` |
| Integration coverage | `rg` over safe-bash source, plugin tests, public packed fixtures and packaging/bundling scripts | No qpdf matches |

The import failures are concrete **checkout** evidence. They are not isolated
packed-consumer checks, declaration compilation or actual browser/workerd
execution. There is no qpdf implementation/declaration pair to pack and qualify.
No tarball was generated or installed for this task; installed acceptance stays
open rather than counting an absent export as a successful packaging check.

Revalidated prerequisites: `safe-bash-pdf-parser.md` leaves `pdf-byte-syntax`,
`pdf-revisions` and `pdf-parser-api` implementation open. The existing
`packages/pdf/src/index.ts` supplies layout rendering. Its serializer imports
`pdf-lib`, requires contiguous generation-zero identities, rejects Encrypt/ID,
and emits only Root/Info trailer references. It cannot establish the required
first-party graph-aware rewrite contract. See the existing
[engine review](safe-bash-qpdf-engine-review.md) and
[command prerequisites](safe-bash-qpdf-command-prerequisites.md).

The requested package-pattern document is moved in unrelated edits. Its
[archived counterpart](archive/safe-bash-command-package-pattern.md) requires
real command implementations and prohibits empty command scaffolds. The move
and existing task-status edits were preserved.

## Capability documentation disposition

No qpdf command, SDK API, supported flag, output, enforced resource limit or
runtime profile is currently available to advertise. A package README and
working import example remain pending a real implementation. Safe-bash's
existing usage/support sections do not advertise qpdf, so they require no
correction. No placeholder package, speculative export or host executor was
added.

The [acceptance inventory](safe-bash-qpdf-acceptance.md) retains all 140 named
options with U (unimplemented) or R (intentional rejection, also unimplemented)
status and exact **proposed** failure contracts. No row is supported. Current
import failure is the package-resolution error above; proposed status-2 command
diagnostics must not be represented as observed runtime behavior. All G01–G60
and O001–O140 cells remain open. The pinned reference is qpdf
`54d6053af283bbeb8b325f4886c0f65cc51f2b80`, reporting a 12.4.2 snapshot, not an
official released 12.4.2 artifact. Supplied native controls were not rerun here.

## Markdown QA after implementation prerequisites

1. Qualify the actual shared raw-object/revision parser and command-owned graph
   writer. Start code changes with failing memory-VFS tests; preserve unknown
   reachable graph data, aliases and raw streams without claiming retention of
   every unreachable revision. Independently check every accepted generated PDF.
2. Implement in `packages/safe-bash-command-qpdf`, named
   `safe-bash-command-qpdf`, `private: true`, TypeScript ESM, with no external
   runtime dependencies. Use canonical leaf contracts and byte streams, explicit
   cancellation, invocation cleanup and bounded accounting. No host executable,
   ambient file, implicit network, native/WASM fallback or dynamic download.
   Safe-bash only composes and exports the opt-in API; test CLI/SDK equivalence.
3. Write the compact user README from verified commands, examples, exact flags,
   limits, output bytes and runtime profiles. Retain all option statuses and
   explain deliberate safety deviations: incompatible writer-setting preflight,
   strict JSON selectors, identity-aware staged publication and collision policy.
   Qualify metadata/navigation/forms/signatures separately from page success.
4. Run maintained package unit/lint routes and selected workspace build closure;
   shared changes require full repository build, test and lint routes. Inspect
   `npm run screenshot-poe-code -- <command>` output for visible CLI changes and
   generated document screenshots when rendering changes. Screenshots are adhoc
   evidence, not unit tests; native controls belong to Markdown QA.
5. Stage via `scripts/package-safe.mjs`, npm-pack only public artifacts and
   install into an isolated consumer outside the checkout without any private
   workspace packages. Execute the real `/commands/qpdf` import and CLI/SDK byte
   controls; compile strict NodeNext declarations. Inspect implementation/types
   for unpublished imports, canonical identity, realm ownership and replay
   invariants. Repeat applicable browser/workerd conditional checks and report
   actual-engine qualification separately. Record and purge temporary evidence
   in `/out`; do not publish the private command package.

## Verification and delivery limits

This increment adds only this Markdown evidence document. No code changed, so
TDD is inapplicable. There is no command workspace unit/lint/build route to run;
no shared infrastructure changed. Runtime budgets, cleanup, isolation, packed
declarations and CLI/SDK equivalence remain unverified. No CLI or document
rendering changed, so screenshot checks are inapplicable. No temporary logs or
generated artifacts were retained.

Local commits: none. Verified remote-main delivery: none. Successful releases:
none. No package publication was performed. Local inspection does not complete
ship-qpdf or establish a release.
