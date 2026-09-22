# Safe Bash private command bundle/export QA

## Integration contract

`resolvePrivateCommandBuild` in `scripts/bundle-safe-bash.mjs` derives entrypoints
from explicitly admitted `safe-bash-command-*` profiles and paired workspace
exports. It bundles maintained `dist` implementations in one splitting build,
with shared chunks under `safe-bash/dist/command-chunks`. The build writes no
workspace artifacts: its in-memory output goes through `packageSafeLibraries`.
The guarded Safe Bash compiler continues admitting sibling declarations only.

`safe-bash-contracts` remains the canonical relative artifact owner. The packager
removes admitted private owners from bundle aliases and externalizes them before
building commands and the portable root. Its existing AST traversal rewrites
these imports, copies the canonical runtime/declaration closure, and rejects
unpublished bare imports. `FsError` remains owned by the canonical SafeFS core.
Command-private helper declarations retain a relative declaration closure even
when their JavaScript is absorbed into a bundle.

Authoritative integration boundaries inspected:

- `packages/safe-bash/package.json`, `scripts/build.mjs`,
  `integration-boundaries.json`, and `scripts/integration-inputs.mjs`.
- `scripts/build-workspaces.mjs`, `scripts/bundle-graph.mjs`,
  `scripts/package-safe.mjs`, and `scripts/bundle-safe-bash.mjs`.
- `packages/package-lint/src/bundle-policy.ts` and its dependency, shipped
  resolution, cross-package ownership, export, and runtime-asset rules.
- `.github/workflows/release-safe.yml` and the maintained
  `scripts/fixtures/safe-packages-*` packed consumer fixtures.

The candidate is the existing ExifTool PNG profile. Its implementation and
contract packages remain private. Public export conditions and default command
registration retain their existing declarations. All command plans and the
PDF/parser/profile gates retain their scope and sequencing. This integration
adds no external runtime dependency to the command. The aggregate Safe Bash
artifact still has its existing external runtime dependencies; this evidence
must not be described as a zero-dependency certification for the whole package.

## Maintained checks

1. Run `npm run build:workspaces -- --workspace=@poe-platform/safe-bash`.
2. Run the focused package/export tests with the maintained root Vitest config:
   `scripts/package-safe.test.ts`, `scripts/bundle-safe-bash.test.ts`,
   `scripts/package-safe-native.test.ts`, and `scripts/bundle-graph.test.ts`.
3. Run repository-wide `npm test` and `npm run lint` for this shared build change.
4. Build scoped artifacts with `node scripts/package-safe.mjs --out-dir
   /out/bundle-export-contract/artifacts --version 0.0.0-bundle-export-contract`.
   Pack scoped SafeFS, SafeJS and Safe Bash, then install only those tarballs in a
   fresh consumer with scripts disabled. Copy the maintained consumer fixtures.
5. Execute `safe-packages-smoke.mjs`, which now awaits the private-command
   fixture, and compile `safe-packages-types.mts`, which includes its typed API
   consumer. Also execute the private fixture and compile its strict ES2022
   NodeNext types with default, browser and workerd conditions.
6. For isolation, use a Node loader that rejects every resolved file URL outside
   the consumer. For the browser/workerd condition checks, initialize Node's own
   web constructors before removing global Buffer. The in-memory regression
   runs in a separate realm with web APIs and no Buffer/process/require globals.
7. Inspect module references using `rewriteModuleSpecifiers`, rather than string
   matching, and reject bare private command/contracts imports in JS and d.ts.
   Verify that ExifTool is absent from `createAgentCommands()`.
8. Purge task-owned temporary artifacts after reviewing evidence.

Canonical regressions create no disk files. One first reproduced the unbundled
runtime helper (`scalar.js` was shipped separately), then verifies bundled
runtime behavior and a strict subpath declaration consumer after removing every
workspace. The other packs real command/contracts source in memfs, removes the
workspaces, denies outside imports, and executes the real Shell and command.
The fixture checks constructor/runtime identity, SDK WeakSet branding, the value
WeakMap, distinct invalid bytes with equal text projections, owned byte copies,
exact carrier/argv identity rejection, Shell command-substitution bytes,
explicit rejection of invalid UTF-8 argv, successful PNG metadata extraction,
and opt-in missing-file handling. Source transpilation in this focused test
prepares in-memory fixtures; the installed-artifact gate uses maintained builds.

## Local evidence, 2026-09-19

Evidence came from the live authorized checkout with unrelated edits preserved.
It is not a committed-archive or release certification.

- Guarded selected build closure: successful, 15 maintained build tasks.
- Focused export/build/native/graph tests: 215 passing tests across four files.
- Repository-wide `npm test`: successful, exit code 0, including maintained
  workspace routes and the final posttest lint stress checks. The workspace
  runner reported 82 workspaces, 30 builds and 50 test routes; workspaces without
  declared tests were explicitly reported as not passes.
- Repository-wide `npm run lint`: successful, zero errors and four warnings.
  Focused ESLint checks also pass for the changed scripts and fixtures.
- Strict packed private-command declarations: successful for default, browser,
  and workerd conditions, without `skipLibCheck`.
- Installed private-command runtime: successful in all three condition cells,
  including the outside-consumer file-import denial loader.
- Maintained packed Node smoke and types: successful with the new private fixture.
- Shipped AST audit: 1,246 Safe Bash JS/declaration files, no bare private command
  or contracts imports. The consumer has no installed private workspace package.
- Default registration check: ExifTool remains absent.
- Bun and actual browser/workerd engines were unavailable/unexecuted; Node
  condition cells and the web-API VM do not certify those engines.
- No product CLI presentation changed; no visual CLI validation was required.

Tarball SHA256:

- Safe Bash: `208d8be91df9733a3588982318154bb6e6d5c4cf5ca88a3d79a530c1183bc941`.
- SafeFS: `de2f3548d367ed720213535c09178dd33aae61c6bec1dea02cf53a4196a8ad5c`.

`/out` refused creation because the filesystem is read-only. The temporary
consumer/artifacts used the task-owned repository `out/bundle-export-contract`
directory instead. No local commit, push, verified remote-main delivery,
publication, or release was performed.
The task-owned temporary consumer/artifact directory was purged after review.

Fixture setup failures were corrected before the passing gates: the SDK requires
an explicit signal; `ImageWidth` is outside this PNG profile, so extraction uses
an independently encoded `Title` chunk; raw byte argv comes from command
substitution; the VM seeds TypeError from the same host realm as TextDecoder.
Removing Buffer before Node initialized its own web constructors also failed in
Node's undici bootstrap, so browser/workerd condition cells initialize those
constructors first. These corrections changed validation fixtures only.

## Export admission review

The private command recipe prepares only ESM `import` targets. A fresh failing
regression demonstrated that distinct `browser`, `workerd` and `require` targets
were accepted despite not being prepared by that recipe. Admission now rejects
conditions other than the qualified `types`/`import` pair. Adding a platform
profile requires implementing and qualifying its build first; existing public
export conditions remain unchanged.

Fresh verification after the guard passed 218 focused build/export tests and
54 direct argument/value/runtime-identity tests. A newly packed consumer passed
the maintained smoke and type fixtures, strict private-command declarations for
default/browser/workerd conditions, and private-command runtime checks with a
loader denying files outside the consumer. Browser/workerd condition cells also
removed Buffer after initializing Node's web constructors. No private workspace
was installed, no default registration changed, and an AST audit of 1,246 shipped
JS/declaration files found no bare unpublished command/contracts imports.

The diff review found no proxy-only runtime functions or new host access in this
integration. Canonical artifact rewriting preserves one contract owner rather
than copying brands into command bundles. Existing allocation, cancellation,
cleanup, snapshots and profile versions are unchanged. Actual browser/workerd
engines and Bun remain unexecuted; these Node condition checks do not certify
those engines. `/out` remains read-only, so fresh manual artifacts use the
task-owned repository `out/bundle-export-contract-review` directory and are
purged after verification.

Final verification after the admission fix passed the guarded selected Safe Bash
build (15 maintained build tasks), all 545 package-lint tests, repository-wide
`npm run lint` (zero errors, four warnings), and the complete `npm test` route
including its posttest lint-stress checks. The maintained runner reported 82
workspaces, 30 builds and 50 test routes; missing unit declarations were explicitly
reported as not passes. SafeJS reported 31,121 passes and 48 skips; Safe Python
reported 84,595 passes. Focused ESLint and `git diff --check` also passed.
The task-owned manual artifact directory was purged. No unresolved finding in
this task's code diff remains. No commit, push, remote-main delivery or release
was performed.

## Fresh task validation, 2026-09-19

The task implementation was already present when this validation started. No
production fix was needed or applied; existing checkout edits were preserved.
The existing ExifTool PNG profile is the real command candidate, without closing
its wider native compatibility gates or changing PDF/parser sequencing.

- Full `npm run build`: passed, including root suffix stages. The maintained
  workspace runner declared 82 workspaces and 81 build routes; its one missing
  build declaration was explicitly not counted as a pass.
- Focused build/export tests: 218 passed across five files.
- Maintained package-lint workspace unit route: 545 passed.
- Direct command/value/runtime-identity contract checks: 108 passed, including
  falsey admission failures, reservation rollback, copy accounting and lifetime.
  The separate Buffer-free string byte-accounting check also passed.
- Fresh installed tarballs: maintained smoke/types passed. Private command
  runtime and strict declarations passed for default/browser/workerd conditions;
  the latter runtime cells removed Buffer after initializing Node web APIs.
  A loader denied file imports outside the installed consumer. No private
  command/contracts workspace was installed.
- AST audit: 1,246 shipped JS/declaration files contained no bare private
  command/contracts imports. ExifTool remained absent from default registration.
  Safe Bash and SafeFS tarball SHA256 matched the receipts above. SafeJS SHA256
  was `013ed55653d281e58e53681d213c88be8cd3afc31135685767476dc15697f064`.
- Repository-wide `npm run lint`: passed completely, zero errors/four warnings,
  including type contracts and workflow lint. Syntax, focused ESLint and
  `git diff --check` also passed.
- Complete `npm test`: passed with exit 0, including native pre/post workspace
  events and root posttest lint-stress checks. The maintained runner reported
  82 workspaces, 30 builds and 50 test routes. Missing test declarations were
  explicitly reported as not passes. Safe Bash executed all 1,252 discovered
  active test files; its 558 build/discovery checks also passed. Safe Python
  reported 84,595 passes across 1,151 files; terminal-pilot reported 293 passes;
  both root posttest lint-stress checks passed. The shared Vitest batches
  reported two skipped tests. SafeJS separately reported filesystem-conformance
  and native-feature skips; those are not runtime-cell passes. Shared unit
  execution reported zero cache hits and 31 cache misses, and the remaining
  workspace execution reported zero cache hits and 20 cache misses. The full
  maintained route ran to completion; this receipt does not substitute a focused
  rerun for the broad gate.

Failed setup/check attempts are separate from those passes: the first manual
smoke run lacked transitive fixture files; copying the maintained complete
fixture set corrected setup. A package-lint selection through the root-only
Vitest config selected no tests; the maintained workspace route above ran them.
The first broad lint attempt returned exit 2 with zero lint errors because its
input-completeness gate failed while builds and temporary consumer preparation
were concurrent. After temporary consumer cleanup, the complete broad lint
rerun passed with no gaps or failure. No product code changed to obtain a pass.

The broad suite retained unrelated compatibility qualifications: an unavailable
isolated development comparator was reported pending, frozen native MIME/profile
mismatches were retained rather than counted as exact matches, Darwin BSD `yes`
was explicitly not treated as a GNU option oracle, and staging-effect gaps were
not described as complete in-place parity. These diagnostics do not requalify
the ExifTool profile or close the other command plans. No test timeout or failing
test remained in the completed route. Build output also reported circular/large
playground chunks as warnings; the complete build still exited successfully.

`/out` remained read-only; task-owned artifacts used repository
`out/bundle-export-contract-validation` and were purged. Actual browser/workerd
engines and Bun were not executed. No CLI presentation changed, so screenshots
were not applicable. No commit, push, remote-main delivery or release occurred.
