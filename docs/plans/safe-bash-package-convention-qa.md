# Private command workspace convention QA

Execute from the repository root against the complete candidate working tree.
The convention is documented in `docs/safe-bash-command-workspaces.md`; this
document describes manual qualification, not a command implementation plan.
Keep all 16 command plans and the shared PDF/parser/package gates intact.

## Ownership and declarations

Read `packages/safe-bash-contracts/package.json` and its source import closure.
Confirm it is private and depends only on admitted first-party filesystem/path
primitives. Confirm all existing Safe Bash command/value/IO/output/plugin,
requirements/filesystem/error contract paths forward to this canonical owner.
Shell parsing and shell state must remain in Safe Bash. Inspect constructor,
argument-carrier and byte-value identity controls before accepting an extraction.

Run the maintained graph planners:

```sh
node --input-type=module -e 'import {createWorkspaceBuildPlan, createWorkspaceTestPlan} from "./scripts/build-workspaces.mjs"; for (const create of [createWorkspaceBuildPlan, createWorkspaceTestPlan]) { const plan = create(process.cwd()); console.log(plan.edges.filter(edge => edge.from.startsWith("safe-bash-") || edge.from === "@poe-platform/safe-bash")); }'
```

Check that commands and Safe Bash depend on contracts, engines have no Safe Bash
return edge, and declared unit prerequisites build imported workspace artifacts.
Do not interpret workspaces without unit declarations as passing tests.

Inspect `scripts/rewrite-workspace-dts.mjs` and
`scripts/rewrite-workspace-runtime.mjs` separately from `scripts/package-safe.mjs`.
The root rewrite uses workspace export targets and the canonical Safe FS routes;
that policy alone does not qualify a command's declarations in a scoped tarball.
The scoped packer must validate private profiles and rewrite both runtime and
type imports into one relative artifact graph. Keep included/excluded declaration
paths and platform profiles explicit rather than broadening traversal.

The guarded builder currently admits profiles named `safe-bash-contracts` or
`safe-bash-command-*`. A command-to-engine dependency establishes build order;
it does not automatically admit that engine's declarations. Inspect the emitted
command type closure before exposing engine types in public options. Any new
compiler-root admission needs explicit policy and negative boundary controls.

## Policy and semantic controls

```sh
npm run test:unit --workspace=@poe-code/package-lint
npm run lint:packages -- --rule safe-bash-command-private
npm run lint --workspace=safe-bash-contracts
npm run build:workspaces -- --workspace=@poe-platform/safe-bash
npx vitest run scripts/package-safe.test.ts
node --import tsx --test packages/safe-bash/tests/contracts/value.test.ts packages/safe-bash/tests/contracts/runtime-identity.test.ts
```

Verify omitted and false privacy flags fail, true passes, and unrelated public
packages are unaffected. Inspect canonical packed runtime/declaration rewriting
and negative profile/route controls. Inspect byte controls for invalid UTF8, BOM,
forged brands, equal-but-copied args, foreign runtime registration, reservation
rollback, falsey errors, owned-copy accounting and invocation cleanup. These are
semantic checks, not performance measurements or upstream parity claims.

## Broad gates and report rendering

```sh
npm test
npm run lint
npm run build
npm run screenshot -- node --import tsx packages/package-lint/src/cli.ts --rule safe-bash-command-private
```

Run broad gates sequentially to avoid adding competing build/test load. Inspect
the generated report screenshot: the rule name, package count, success marker
and summary must be legible and consistent with package-lint's other reports.
The policy changes the package-lint report; it changes no poe-code command flow.
Use the maintained screenshot runner's arbitrary-command mode for this report.
Record failures and investigate timeouts; an isolated rerun does not complete a
failed broad gate. Preserve unrelated work and do not loosen deadlines to pass.

Store temporary evidence in `/out`; if that mount is unavailable, record that
limitation and use the repository's ignored `out` directory. Purge task-owned
temporary evidence after capturing results. The screenshot runner initially
writes to `screenshots`; move only the task's generated image into the evidence
directory after inspection. Report passes, failures, skips,
unsupported platform cells and incomplete runs separately.

## Future command admission

For each actual new command, inspect the guarded builder, explicit private
profile, opt-in facade/export, integration boundaries and shipped dependency
closure. Require a real handler and its own private workspace, LICENSE, README,
source/test configs and maintained build/lint/unit declarations. Do not create
empty packages, migrate existing commands or alter default aggregates here.

Extend and execute isolated packed consumers using the routes in
`.github/workflows/release-safe.yml`. Verify strict NodeNext declarations,
root/contracts/command constructor identity, actual Shell-created byte argv,
VFS/scripts/pipes/middleware, denied host authority, limits and cleanup. Exercise
original/checkpoint/replay where the command affects those routes. Every
advertised Node/Bun/browser/workerd cell needs its own evidence; unavailable
cells remain unverified. Native oracles and development tools never ship.

PDF metadata/parser qualification precedes text/layout, which precedes lossless
transformations. Rendering, OCR and format writers retain their intended
profiles and versioned asset gates; no external parser is adopted by this QA.

## Candidate qualification outcome

The inspected working tree preserves the existing contracts extraction, private
command implementations and compatibility re-exports. The convention policy and
maintained unit prerequisites were already present as working-tree changes.
This continuation adds contracts usage documentation and this QA procedure;
it adds no command or registration. Local commits `23e6a9da3` and `61b9c55dc`
address two reproduced Safe-JS fixture timeouts without changing runtime code,
assertions or deadlines.

Full `npm run lint` and `npm run build` passed on that source candidate. Lint
reported four warnings in untouched files. Build reported the Python spawn
workspace's absent build declaration rather than counting it as a pass.
Maintained graph planning, contracts lint/typechecks, independent privacy and
byte/identity/realm/allocation/cleanup controls, public SDK imports and the
manually inspected package-lint screenshot passed.

Full `npm test` did not pass. The initial attempt reproduced the retained-callback
and FIFO-agent timeouts and was interrupted after failure. Following their
fixture fixes, the full retry passed both files (21 and nine cases), the shared
batches, Safe Bash (41,880 passes, 829 skips), private commands and contracts.
It then reported four 5-second timeouts and three consequent missing-proof
assertion failures in `input-error-projection.test.ts`. All 19 cases in that
file passed in isolation with unchanged deadlines. Multiple other workspace
runs were active on the host; contention was observed, but causation was not
established. No source fix for those remaining failures was validated.

The already-failed retry was interrupted. Remaining Safe-JS cases, Safe Python
and root posttest were not completed in that route. A focused rerun does not
complete this broad gate. Shared batches also reported one skipped case;
unavailable optional comparators and missing declarations are not passes.
Isolated packed Node/Bun/browser/workerd consumers and publication remain
unverified. No push, verified remote-main delivery or release occurred.
