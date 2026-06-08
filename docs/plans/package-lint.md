---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# package-lint

Static analysis that resolves every workspace package's dependency tree and verifies it is configured correctly for this mixed published/private monorepo — judged from facts (the `private` flag, real vendoring into `dist/`, dependency edges), never from naming conventions.

## 1. What we're building

A tool that looks up each package, figures out its dependency tree, and determines whether it is configured correctly — regardless of naming conventions. Driven by three recurring problems:

- Some packages are published, some are not.
- When a dependency is **not** published, it must be bundled into the main package.
- A published dependency with the **same name** as an internal unpublished dependency once got included instead of the internal one.

Decisions taken (from chat):

- New package `@poe-code/package-lint`, run via `npm run lint:packages`, folded into `npm run lint`.
- Offline only — no npm registry calls. "Published" is derived from the explicit `private` flag plus release-workflow wiring, never from `@scope` vs unscoped (scope does not map to publish status: `toolcraft-design` is scoped and public; `agent-code-review` is unscoped and private).
- Rollout is fix-then-hard-fail: clear the existing violations, then `lint`/CI block on any violation.
- This plan builds the analyzer; applying the fixes it surfaces is a follow-up.

Non-goals:

- Not a general npm linter (no unused/missing-dep detection à la depcheck, no `npm audit`).
- Not a fixer — it reports; it does not edit `package.json` or workflows.
- No naming-convention rules of any kind.
- No network. The same-name collision bug is caught **factually** — by guaranteeing every referenced private package is vendored into the published artifact and that no shipped code imports an unresolvable bare name — not by any registry lookup or scope pattern.

## 2. User-facing shape

### Invocation

```sh
npm run lint:packages             # human report, non-zero exit on any violation
npm run lint:packages -- --json   # machine-readable, for CI logs / tooling
npm run lint                      # eslint + types + workflows + packages
```

`lint:packages` maps to the package bin `poe-package-lint` (no `poe-code` subcommand — dev tooling, not a user feature).

| Flag          | Effect                                                           |
| ------------- | ---------------------------------------------------------------- |
| `--json`      | Emit violations as JSON instead of the rendered report.          |
| `--quiet`     | Print only violations, suppress the per-package "clean" summary. |
| `--rule <id>` | Run a single rule by id (repeatable); default runs all.          |

Exit `0` clean · `1` violations found · `2` tool error (unreadable/malformed `package.json`).

### Example output (rendered via design-system)

```
package-lint · 6 rules · 60 packages

✖ shipped-dist-deps-unresolvable        (1)
    bin poe-superintendent-mcp → packages/superintendent/dist/mcp.js
      imports toolcraft, tiny-stdio-mcp-server by bare name; neither is in
      root "dependencies" and the tarball ships no node_modules for them.
      ERR_MODULE_NOT_FOUND on install. Bundle them, or add to root deps.

✖ no-published-to-private-dep           (7)
    toolcraft-codemode → @poe-code/agent-script   (dependencies, private)
    toolcraft          → @poe-code/config-mutations (optionalDependencies, private)
    … 5 more

✖ public-needs-publish-wiring           (9)
    auth-store            no release-*.yml; required by published mcp-oauth, toolcraft, toolcraft-openapi
    toolcraft-design  no release-*.yml; required by published toolcraft, toolcraft-openapi
    mcp-oauth             no release-*.yml; required by published tiny-http-mcp-oauth-test-server, tiny-mcp-client, toolcraft

✖ published-dep-needs-version-range     (17)
    mcp-oauth         → auth-store@*    → use a concrete range
    opencode-poe-auth → poe-oauth@*     → use a concrete range
    … 15 more

bundle-self-contained                   ✓
release-workflow-maps-to-package        ✓

5 rules failed · 34 violations
```

`--json` shape:

```json
{
  "summary": { "packages": 60, "rules": 6, "violations": 34, "ok": false },
  "violations": [
    {
      "rule": "shipped-dist-deps-unresolvable",
      "package": "@poe-code/superintendent",
      "severity": "error",
      "via": "bin:poe-superintendent-mcp",
      "detail": { "unresolved": ["toolcraft", "tiny-stdio-mcp-server"] },
      "message": "shipped dist imports bare names not in root dependencies",
      "fix": "Bundle poe-superintendent-mcp so these are inlined, or add each to root \"dependencies\"."
    }
  ]
}
```

### Rule catalog

Every rule decides from facts. "Published" = `private !== true`. "Shipped" = the package's built `dist` reaches the published `poe-code` tarball (a root `files` entry or a root `bin` target path under `packages/<dir>/dist`). Packages with a Python project file are tagged `pypi` and exempt from the npm rules.

| id                                      | Proves (fact checked)                                                                                                                                                                                                                                                                                | Caught in this repo today                                                                         |
| --------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `shipped-dist-deps-unresolvable`        | Every runtime dependency of a shipped (tsc-emitted, unbundled) dist resolves from the published tarball — it is in root `dependencies`, a Node builtin, or itself bundled. A bare workspace/third-party import that isn't installed = `ERR_MODULE_NOT_FOUND`.                                        | `poe-superintendent-mcp` → `toolcraft`, `tiny-stdio-mcp-server`                                   |
| `no-published-to-private-dep`           | No published package depends (deps/peer/optional) on a private workspace package — it will never exist on npm. `optionalDependencies` is the exact vector for the same-name collision.                                                                                                               | 7: `toolcraft-codemode`→`@poe-code/agent-script`; `toolcraft`→ 6 private `@poe-code/*` (optional) |
| `published-dep-needs-version-range`     | A published→published workspace dep uses a concrete range, never `*`/`workspace:*` (on npm `*` resolves to whatever the registry returns — the collision vector).                                                                                                                                    | 17: `mcp-oauth`→`auth-store@*`, …                                                                 |
| `public-needs-publish-wiring`           | Hygiene: a public package with no release workflow or no `repository.directory` has no publish path — it cannot be published as-is (`warning`). Whether a published package actually _needs_ it on npm is decided from real imports by `imported-workspace-dep-unresolvable`, not from declarations. | 8 warnings (public packages with no release workflow).                                            |
| `release-workflow-maps-to-package`      | Every release workflow targets an existing, non-private (or pypi) package — no drift between workflow and packages.                                                                                                                                                                                  | 0                                                                                                 |
| `no-cross-package-relative-import`      | No source file imports a sibling package by a relative path that escapes its own directory (e.g. `../../mcp-oauth/dist/index.js`) — it bypasses the dependency graph and breaks once published. Error in shipped code, warning in tests.                                                             | 12: `tiny-mcp-client`, `memory`→`tokenfill/dist`, `terminal-pilot` template paths, …              |
| `imported-workspace-dep-unresolvable`   | Import-driven: every workspace package a published package's shipped source **actually imports** (runtime, non-type-only) is vendored (`bundledDependencies`) or itself reaches npm. Catches **undeclared** imports the package.json rules can't see.                                                | 1: `terminal-pilot`→`@poe-code/agent-skill-config` (undeclared import of a private package).      |
| `exports-subpath-resolvable`            | Import-driven: a bare subpath import of a workspace package (e.g. `toolcraft/cli`) must be a subpath the target's `exports` map exposes — Node gates `exports`, so an unlisted subpath is `ERR_PACKAGE_PATH_NOT_EXPORTED` once published (masked in-repo by test/bundle aliases).                    | 0 today (54 subpath imports across 19 exports-mapped packages all resolve — regression guard).    |
| `bundle-self-contained` _(build-aware)_ | The bundled entry (`dist/index.js`, `agent.js`, `providers/*`) inlines every referenced workspace package and externalizes nothing absent from root `dependencies`. Consumes the esbuild metafile.                                                                                                   | 0 (bundle is clean)                                                                               |

The vendoring guarantee is layered: `shipped-dist-deps-unresolvable` (static, package.json) catches the superintendent bin break without a build; `imported-workspace-dep-unresolvable` and `no-cross-package-relative-import` parse the **real** `src` import graph with the TypeScript compiler's own scanner (the engine `typescript-eslint` runs on), catching undeclared/cross-boundary imports declarations can't see; `bundle-self-contained` (build-aware) consumes the metafile. Private packages that nothing in the published surface imports (`worktree`, `e2e-test-runner`, `cached-resource`, `agent-child-process`, `py-poe-spawn`) are correctly _not_ vendored and raise nothing.

## 3. Implementation details and technical decisions

### Architecture

`packages/package-lint/` — pure model + rule functions + reporter + CLI. No logic in core; the root only wires the script.

- **`loadWorkspace(fs, rootDir): WorkspaceModel`** — reads root + every `packages/*/package.json` and the release workflows once into a plain data model. `fs` is injected (real fs in the CLI, `memfs` in tests). No network, no build.
- **`WorkspaceModel`** — `{ root: PackageInfo, packages: PackageInfo[], byName: Map, byDir: Map, releaseWorkflows: ReleaseWorkflow[], shippedDirs: Set<string>, binTargets: BinTarget[] }`. `shippedDirs` is derived from root `files` + root `bin` paths under `packages/`.
- **`PackageInfo`** — `{ name, dir, private, version, dependencies, peerDependencies, optionalDependencies, repositoryDirectory, ecosystem: "npm" | "pypi", exports, bin, files }`. `ecosystem` is `pypi` when a `pyproject.toml`/`setup.py`/`setup.cfg` sits in the package dir — detected from the single `readdir` already taken to find `package.json`, not a per-file `stat` fan-out, and never a name pattern.
- **`Rule`** — `(model: WorkspaceModel, build?: BuildView) => Violation[]`. Pure. Rules live one-per-file under `src/rules/` and register in `src/rules/index.ts`. A rule that needs `build` and gets `undefined` returns `[]` plus a single skipped-note.
- **`BuildView`** — `{ inlinedDirs: Set<string>, externals: Set<string> }`, parsed from `dist/metafile.json`. `undefined` when the metafile is absent.
- **Reporter** — `formatReport(result, { json })`. Rendered output uses `toolcraft-design` (no `chalk`/`@clack` directly, per house style). `--json` bypasses rendering.
- **CLI** — `src/cli.ts` (bin `poe-package-lint`): parse flags → `loadWorkspace` → load `BuildView` if present → run rules → print → exit code.

### Determining "published"

Two explicit signals, combined — never naming:

1. `private !== true` → the package _can_ be published.
2. A release workflow that actually builds/publishes the package. Path filters (`on.push.paths: packages/<dir>/**`) are the primary signal; a workflow with no path filter (e.g. `release-opencode-poe-auth.yml`) is matched by parsing its publish step's target directory. `release-workflow-maps-to-package` flags any workflow whose target can't be resolved to a package, so the two signals stay consistent.

### Determining "vendored into dist"

- **Shipped tsc dists** (`shippedDirs`): the bin's `dependencies` must each be a root `dependency` or a Node builtin (package.json only — catches superintendent without a build).
- **Real imports** (`imported-workspace-dep-unresolvable`, `no-cross-package-relative-import`): each package's `src` is parsed with the TypeScript compiler's own scanner (`ts.createSourceFile`, the engine `typescript-eslint` runs on). This reflects what the code _actually_ imports — runtime, non-type-only — so it catches **undeclared** bare imports of private packages and relative imports that escape the package boundary, which declaration checks can't.
- **The esbuild bundle**: which workspace sources got inlined is read from `dist/metafile.json`. To avoid drift, the alias/external graph is computed by a single shared helper used by _both_ `scripts/bundle.mjs` and the build-aware rule (see Code plan); `bundle.mjs` is changed only to persist the metafile it already produces.

### Edge cases

- `optionalDependencies` on a private package: still a violation (severity `error`) — it is the precise same-name collision vector, even though npm tolerates a missing optional at install. Note this is _not_ suppressed by `bundledDependencies`: the loose `optionalDependencies: "*"` + bundling is exactly the collision (npm can resolve `*` to a public same-name package and vendor the wrong one).
- `bundledDependencies` (npm's vendoring instruction): a dep listed here ships inside the consumer's tarball, so for `public-needs-publish-wiring` it does **not** require its own publish path. This is a declared package.json fact npm acts on at pack time, not a naming guess.
- A public package without publish wiring is **not** treated as a publisher: it never reaches npm, so it imposes no publish requirement on its own deps (avoids the circular "an unpublishable package requires its deps be published").
- `pypi` packages: exempt from all npm rules; `py-poe-spawn` is private + has a Python release workflow.
- Packages that are public but bundled-only (e.g. `toolcraft-design` shipped via root `files`): `public-needs-publish-wiring` flags them at `warning` (no publish path). Whether they are genuinely broken is decided by `imported-workspace-dep-unresolvable` from real imports — if a published consumer imports them unbundled, that consumer is the error.
- Lint run before a build: build-aware rules skip with a note; CI runs `lint:packages` after `build` so the metafile exists.

### Performance

Target: a whole run well under a second, so it adds negligible time to `npm run lint`. The package.json/workflow load + those rule passes are **~10ms**; parsing every package's `src` for the import-driven rules adds the bulk (~0.8s on the real tree). Guaranteed by what it does **not** do:

- **Never runs esbuild, never shells out, never touches the network.** Inlining facts come from reading the already-built `dist/metafile.json`, not from re-bundling. The esbuild cost is paid once by `build` (which bundles anyway); the metafile is a free byproduct. Running esbuild inside the linter — what the throwaway prototype did — is the one thing that would make it slow (seconds), and it is explicitly out.
- **Import parsing uses the TS scanner, not a full type-check.** `ts.createSourceFile` (parse only, no program/`checker`) per file is fast; no resolution, no type inference. This is the linter-grade parser `typescript-eslint` is built on.
- **Single load pass.** `loadWorkspace` reads root + the ~60 `packages/*/package.json`, the release workflows, and each `src` tree once, in parallel (`Promise.all`), into an immutable model. Rules are pure in-memory passes over that model.
- **One `readdir` per package dir** yields both `package.json` and the `ecosystem` marker; no per-file `stat` fan-out (~60 `readdir`s, not ~180 `stat`s).
- **`dist/metafile.json` parsed once** by `loadBuildView`, shared across build-aware rules; only `inputs` keys and `outputs[].imports` are touched.

No caching layer — the work is small enough that a cold run is already fast, so hashing inputs for a turbo cache would cost more than it saves. (`metafile.json` is added to the `build` task `outputs` only so turbo restores it from the build cache, not for the linter's sake.)

### Flags / config

No env vars, no config file. Flags only (`--json`, `--quiet`, `--rule`). Default-on: all rules.

## 4. Interfaces and test plan

### Module boundary (exported from `@poe-code/package-lint`)

```ts
export function loadWorkspace(fs: LintFs, rootDir: string): Promise<WorkspaceModel>; // also scans src imports
export function loadBuildView(fs: LintFs, rootDir: string): Promise<BuildView | undefined>;
export const rules: Rule[];
export function runRules(model: WorkspaceModel, build?: BuildView, only?: string[]): LintResult;
export function formatReport(result: LintResult, opts: { json: boolean; quiet: boolean }): string;
// WorkspaceModel carries sourceImports (real src import graph) for the import-driven rules.

export interface LintFs {
  readFile(p: string): Promise<string>;
  readdir(p: string): Promise<{ name: string; isDirectory(): boolean }[]>;
}
export interface Violation {
  rule: string;
  package: string;
  severity: "error" | "warning";
  via?: string;
  detail: Record<string, unknown>;
  message: string;
  fix: string;
}
export interface LintResult {
  summary: { packages: number; rules: number; violations: number; ok: boolean };
  evaluated: string[];
  violations: Violation[];
  skipped: string[];
}
export type Rule = { id: string; run(model: WorkspaceModel, build?: BuildView): Violation[] };
```

`scripts/bundle.mjs` gains, from a shared helper:

```js
export function resolveBundleGraph(rootDir, packageJsons): { entryPoints: string[]; alias: Record<string,string>; external: string[] };
```

### Tests

- **Unit (memfs, no disk, no network)** — one `*.test.ts` per rule. Each builds a synthetic in-memory workspace and asserts a positive (violation raised) and a negative (clean) case. Proves each rule's logic in isolation. Fast (< a few ms each).
- **Integration baseline (`repo-baseline.test.ts`)** — runs `loadWorkspace` + `runRules` against the _real_ repo and asserts the violation set equals committed `baseline.json`. The baseline is the catalogue of the real issues found here (46 today); it is both regression guard and the fix checklist. Reads real files and parses `src` (no build needed — build-aware rules skip).
- **Build-aware rule** — a focused test feeds a synthetic `metafile.json` fixture to `bundle-self-contained` (positive + negative); no real build in unit tests.
- **Manual QA (markdown, not a script)** — `docs/qa/package-lint.md`: run `npm run lint:packages`, confirm the rendered report matches the failing rules; run `-- --json` and confirm shape; run after `npm run build` and confirm `bundle-self-contained` participates.

### Rollout

Fix-then-hard-fail. Order: land the analyzer with `baseline.json` capturing today's 46 violations (test green against the baseline) → fix violations in a follow-up, shrinking `baseline.json` toward `[]` → once empty, chain `lint:packages` into the `lint` aggregate and make any violation fail `lint`. CI runs `npm run lint`, so chaining now would fail it — that step waits until the baseline is empty.

### Autonomy checklist

- Build the package, rules, reporter, CLI from the signatures above.
- Generate `baseline.json` by running the analyzer against the repo (committed as the starting state).
- Wire `lint:packages` into root scripts (chaining into the `lint` aggregate is deferred to the hard-fail flip, per rollout).
- Persist `dist/metafile.json` from `bundle.mjs` via the shared `resolveBundleGraph` helper.
- Verify: `npm run lint:packages` exits 1 and lists exactly the baseline; unit tests green; `npm run lint:packages -- --json` parses.

## 5. Code plan

### Create

| File                                               | Purpose                                                                                                                       |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `packages/package-lint/package.json`               | Private package; bin `poe-package-lint`; deps: `toolcraft-design`, `typescript` (import scanner), `yaml`.              |
| `packages/package-lint/README.md`                  | Rules, flags, exit codes, env (none).                                                                                         |
| `packages/package-lint/tsconfig.json`              | Standard package tsconfig.                                                                                                    |
| `src/model.ts`                                     | `loadWorkspace`, `loadBuildView`, types, `shippedDirs`/`binTargets` derivation, release-workflow parsing, source-import scan. |
| `src/source-imports.ts`                            | `scanSourceImports` — parses each `src` import with the TypeScript compiler scanner.                                          |
| `src/rules/shipped-dist-deps-unresolvable.ts`      | The vendoring rule (static).                                                                                                  |
| `src/rules/no-published-to-private-dep.ts`         |                                                                                                                               |
| `src/rules/published-dep-needs-version-range.ts`   |                                                                                                                               |
| `src/rules/public-needs-publish-wiring.ts`         | Publish-path hygiene warning (static).                                                                                        |
| `src/rules/release-workflow-maps-to-package.ts`    |                                                                                                                               |
| `src/rules/no-cross-package-relative-import.ts`    | Import-driven; flags relative imports escaping the package boundary.                                                          |
| `src/rules/imported-workspace-dep-unresolvable.ts` | Import-driven; published code importing an unbundled/unpublished workspace package.                                           |
| `src/rules/exports-subpath-resolvable.ts`          | Import-driven; bare subpath import of a workspace package not exposed by its `exports` map.                                   |
| `src/rules/bundle-self-contained.ts`               | Build-aware; consumes `BuildView`.                                                                                            |
| `src/rules/index.ts`                               | Rule registry (`rules: Rule[]`).                                                                                              |
| `src/report.ts`                                    | `formatReport` via design-system + JSON.                                                                                      |
| `src/cli.ts`                                       | bin entry; flag parsing; exit codes.                                                                                          |
| `src/index.ts`                                     | Public API re-exports.                                                                                                        |
| `src/rules/*.test.ts`                              | Per-rule memfs unit tests.                                                                                                    |
| `src/repo-baseline.test.ts`                        | Baseline integration test.                                                                                                    |
| `packages/package-lint/baseline.json`              | Committed real-violation snapshot (46 found).                                                                                 |
| `scripts/bundle-graph.mjs`                         | Shared `resolveBundleGraph` extracted from `bundle.mjs`.                                                                      |
| `docs/qa/package-lint.md`                          | Manual QA steps.                                                                                                              |

### Change

| File                  | Change                                                                                                                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/bundle.mjs`  | Import `resolveBundleGraph` from `scripts/bundle-graph.mjs` (replace the inline alias/external computation); write `dist/metafile.json` after the main build.                                                                |
| `package.json` (root) | Add `"lint:packages": "poe-package-lint"`; add `@poe-code/package-lint` devDependency. Chaining it into the `lint` aggregate is deferred to the hard-fail flip (rollout), so CI stays green while the baseline is non-empty. |
| `turbo.json`          | No change. The root bundle runs `bundle.mjs` outside turbo (only `packages/*` builds are turbo tasks), so a `dist/metafile.json` output entry would be inert; per-package `dist/**` already covers package dists.            |

### Build order (keeps the branch green)

1. `model.ts` + types — compiles, no rules yet.
2. Each rule + its memfs test, one at a time (TDD: failing test → rule → green).
3. `report.ts` + `cli.ts` + `index.ts`; wire root `lint:packages`.
4. Extract `scripts/bundle-graph.mjs`, point `bundle.mjs` at it, persist `dist/metafile.json`; add `bundle-self-contained` + its fixture test.
5. Generate and commit `baseline.json`; add `repo-baseline.test.ts` (green against baseline).
6. Follow-up (separate change): fix the 34 violations, shrink `baseline.json` to `[]`, flip `lint` to hard-fail.
