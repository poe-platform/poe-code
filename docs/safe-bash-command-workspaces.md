# Private Safe Bash command workspaces

Every newly added command belongs in `packages/safe-bash-command-<name>` with
manifest name `safe-bash-command-<name>` and `private: true`. Package-lint enforces
privacy with `safe-bash-command-private`, regardless of publication wiring.
Existing commands stay where they are unless an authorized issue explicitly requests extraction. Creating a workspace does not register a
command or grant build admission. Each command retains one plan in `docs/plans`.

## Package contract

Use the existing exiftool and wkhtmltopdf workspaces as concrete package examples,
not empty scaffolds. The minimal manifest declares:

- `name`, a version matching the admitted private profile, `private: true`,
  `license`, `type: "module"`, `main: "dist/index.js"`, and
  `types: "dist/index.d.ts"`.
- An explicit `exports["."]` pair with `types: "./dist/index.d.ts"` and
  `import: "./dist/index.js"`; additional subpaths require explicit admission.
- `files: ["dist", "LICENSE"]`; retain a LICENSE with the actual source license
  and notices for any shipped assets. npm includes the package README.
- `build: "node ../../scripts/guard-package-dist.mjs && tsc"`,
  `typecheck: "tsc --noEmit && tsc -p tsconfig.test.json"`,
  `lint: "eslint src && npm run typecheck"`, and `test` / `test:unit` targeting
  the package's actual tests (the current packages use
  `node --import tsx --test src/*.test.ts`). Do not declare an empty passing suite.
- Explicit first-party workspace prerequisites in dependency declarations. The
  current bundled command packages use development dependencies for contracts
  and engines; these edges still participate in the maintained build DAG.
  Tooling and pinned upstream test oracles are development-only.

The source `tsconfig.json` uses strict NodeNext ESM, `rootDir: "src"`,
`outDir: "dist"`, `noEmit: false`, `declaration: true`,
`noUncheckedIndexedAccess: true`, and `exactOptionalPropertyTypes: true`.
It includes `src`, excludes unit tests and test-only fixtures, and selects only
libraries/types required by the advertised runtime. Following the command
packages, extend the root tsconfig and override `types: []` and the appropriate
`lib`. The test config extends the source config, sets `noEmit: true`, includes
`src`, clears exclusions, and adds Node types for the current node:test runner.
Tests use memfs for filesystem effects and mocked external capabilities.

Write a user-facing README describing the supported command profile, limits,
options, runtime requirements, and an example using the public Safe Bash import
and explicit SDK registration. Do not instruct users to install the private
workspace or claim complete upstream parity without its command-plan gates.

## Ownership and identity

`safe-bash-contracts` already owns command/arguments/value, IO/stream, output,
plugin, requirements, filesystem and error contracts. Its sole prerequisite is
`@poe-code/safe-fs`, with runtime primitives imported from the admitted core.
Existing Safe Bash contract paths remain compatibility re-exports. Do not copy
implementations into commands: the canonical WeakSet/WeakMap brands,
`commandRuntimeIdentity` and error constructors must have one owner per runtime
profile. The extraction does not include shell parsing or state.

A command factory returns an actual `CommandDefinition` with its handler.
A plugin is appropriate when it owns registration; avoid functions that merely
proxy another function. Safe Bash owns composition, while narrowly scoped private
pure engines own shared parsing/algorithms. Engines never depend on Safe Bash.
The dependency direction is filesystem/path primitives → contracts/engines →
commands → Safe Bash. Even a development-only return edge creates a build cycle.

Preserve the paired canonical carrier and context: `getCommandArguments` requires
both its WeakSet brand and `carrier.args === context.args`. Spreading or mapping
args loses that pairing. For byte semantics consume carrier bytes/values, never
re-encode lossy presentation strings. `ByteShellValue` copies owned bytes and
preserves BOM presentation with `ignoreBOM: true`; distinct invalid byte sequences
can display identically. Account copies from `bytes()` with the allocation
contract, retaining reservation rollback, falsey failures and invocation lifetime.
The leaf's current string-byte accounting is Buffer-free, but its complete
safe-fs/core closure and TextEncoder/TextDecoder prerequisites still need platform
qualification before advertising browser/workerd support.

## Maintained integration

Root `package.json` discovers `packages/*`. Package `build` and `test:unit`
scripts explicitly declare membership; `turbo.json` supplies maintained task
prerequisites. The existing contracts and command unit tasks declare `^build`
so fresh unit runs build the artifacts their source imports resolve. Add the same
unit prerequisite for a new command or engine that imports built workspaces.
Use `scripts/build-workspaces.mjs`'s `createWorkspaceBuildPlan` and
`createWorkspaceTestPlan` to verify closure; do not invent a parallel task list.
Use the maintained selected-workspace build route for focused verification and
`npm test` for the complete unit route.

Safe Bash continues using `packages/safe-bash/scripts/build.mjs`, not ordinary
sibling-source tsc. Explicitly deep merge the command's private workspace profile
in `packages/safe-bash/package.json` (`poeCode.integration.privateWorkspaces`),
its dependency edge and its public `./commands/<name>` export. Keep version,
dependency and paired dist export admission exact. Respect
`integration-boundaries.json` and `scripts/integration-inputs.mjs`; held sources,
regular-file checks and authenticated owners are not reusable command inputs.
An explicit static facade forwards the implementation; imports do not register
it. Registration uses the SDK registry and existing collision/replacement policy;
CLI integration uses that same SDK path. Default aggregates change only through
an explicitly requested command integration.

`scripts/package-safe.mjs` performs AST-based runtime/declaration rewriting into
canonical relative private artifacts. Do not add per-command branching or ship
bare unpublished imports. All entries within a platform profile must share the
same canonical owner; separately bundling contracts into each command breaks
brands. Keep current types/import-only command profiles until additional export
conditions are qualified.

Zero dependencies means zero external runtime dependencies throughout the shipped
JS and asset graph, including transitive engines. First-party private code may be
bundled; an empty dependencies object alone proves nothing. Development tools and
native controls never ship. Fonts/models/codecs require versioned asset admission,
licenses and packed-consumer checks.

Before integrating each real command, extend maintained `scripts/package-safe.test.ts`
memfs coverage and `scripts/fixtures/safe-packages-*` isolated tarball consumers.
Verify the subpath and strict NodeNext declarations without command workspaces,
actual Shell-created byte argv, constructor/runtime identity, VFS/scripts/pipes/
middleware, host denials, budgets and packed assets in each advertised profile.
Run package-lint's resolution, private-dependency, bundling, cross-package and
asset gates; do not exempt the command. GitHub owns publication.

All 16 command plans and shared PDF/parser/package gates remain authoritative.
PDF parser metadata comes first, then pdfinfo metadata, pdftotext text/layout,
and lossless qpdf transformations. Bounded text utilities still require GNU
byte/locale/cost rules; CSV requires shared Decimal/date/inference semantics;
htmlq requires its HTML5 tree and legacy selector/serializer contract. PDF,
RTF and metadata formats retain their parser/ordering/writer qualification,
including independent writability (DOCX's native reader has no writer).
Office conversion, HTML rendering and OCR retain their layout, model, codec,
font and versioned asset work; they are not small wrappers. No external runtime
parser recommendation or native shipping dependency is adopted here.

## Convention verification

Verified against checkout HEAD `8960ebd242ce1d3354babb2a741295c637d4eefc`
with the convention changes applied. The privacy tests failed before the rule
was added for both omitted and false private flags, then passed through the
registered policy. Verification passed:

- Maintained `createWorkspaceBuildPlan` and `createWorkspaceTestPlan`.
- Full `npm test`, including declared workspace unit tasks, prerequisite builds,
  native pre/post lifecycle scripts and root lint-stress posttest. Missing unit
  declarations and optional unavailable/skipped cases remain explicitly reported;
  they are not counted as passes.
- Full `npm run lint` (zero errors, four warnings in untouched files), focused
  package-lint typecheck, and contracts source/test typechecks.
- Package-lint's 545 tests; the focused private-status rule against the current
  workspace; 145 package-safe tests and 199 workspace-builder tests.
- `git diff --check`.

This task preserves the existing contracts extraction and command implementations.
It adds no command, registration, export condition or shipping dependency. No
isolated tarball was installed and no browser/workerd runtime or release was
qualified here; the maintained packed-consumer and platform gates above still
apply to each future command integration.

## Task diff review

Reviewed the convention diff against the guarded builder, integration boundaries,
private artifact rewriting, maintained workspace declarations and packed-consumer
routes. No blocking finding was identified in the diff, and no implementation
simplification was supported by the tests. The privacy policy adds no runtime
abstraction or host access; the unit prerequisites preserve the existing build
direction. Existing contract compatibility paths, canonical brands, runtime
identity, snapshot behavior and private profile versions remain unchanged.

Fresh focused verification passed 909 Vitest cases covering package-lint,
package-safe and workspace build/dependency/cache behavior, plus 54 direct
byte-value and runtime-identity cases covering ownership, reservation rollback,
falsey failures and invocation lifetime. Contracts lint and source/test
typechecks, package-lint typecheck, changed TypeScript ESLint checks, maintained
build/unit graph planning and the private-command policy on the current workspace
model passed. Platform and isolated tarball qualification remain the future
integration gates described above.

Full verification for this review is blocked. `npm run lint` completed on rerun
with zero errors and four warnings in untouched files; its first guarded audit
was incomplete. The first `npm test` run passed the shared suites, Safe Bash
(41,880 passes, 829 skips), private commands and contracts, but failed Safe Python's
strict Shift-JIS plane-16 encoding test at its 5-second deadline. That case passed
in isolation in 890 ms, and its entire file passed all 30 cases on rerun.
The maintained full-route retry then reported 10-second child-process failures
in Safe Bash's search safety probes: UTF8 quota 9, `(?i)foo` and `[[:alpha:]]`.
The already-failed retry was interrupted; it is not a passing full-unit result.
All 19 search safety tests subsequently passed in a direct isolated file run,
including the three failed probes, without changing their deadlines.
Concurrent host load was observed, but a causal diagnosis and successful full
verification remain unresolved and block completion. No unrelated runtime code
or deadlines were changed. No commit, remote delivery or release was performed.
