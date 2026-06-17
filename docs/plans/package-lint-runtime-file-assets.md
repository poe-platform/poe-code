---
$schema: https://poe-platform.github.io/poe-code/schemas/plans/plan.schema.json
kind: plan
version: 1
---

# package-lint runtime file assets

Teach package-lint to catch runtime file packaging mistakes before publish.

## 1. What we're building

Improve `@poe-code/package-lint` so every package-owned file or directory that runtime code uses is handled and bundled correctly. The first recurring examples are Markdown templates, Handlebars templates, Mustache templates, prompt files, skill templates, and built-in corpora, but the rule is not template-specific: if code reads, stats, opens, streams, or enumerates a package-local file at runtime, package-lint must prove that file is present in the artifact that runs the code.

- Runtime file assets are collocated with the package that owns and reads them, instead of being reached through another package's source tree, dist tree, or repository-relative paths.
- Runtime file assets are copied or generated into the package's shipped runtime tree, usually `dist`, when the code runs from built JavaScript.
- Runtime file assets are included in every artifact that can execute the package: the package's own published npm tarball, the root `poe-code` tarball when it ships package `dist` directly, and any private dependency tarball bundled into another published package.

The linter should catch the two failure modes that keep recurring:

- A package reads a file from outside its own package boundary, so the code works in the monorepo but breaks or depends on incidental repo layout after publish.
- A package has the file in `src`, but the asset is missing from `dist`, missing from the package `files` allowlist, missing from the root package `files` allowlist when shipped directly, or missing from the bundled private dependency that a published package relies on.

The preferred fix shape is package-local ownership: if `packages/superintendent` uses `src/templates/SKILL_superintendent.md`, then `packages/superintendent` owns the template, builds or copies it to `dist/templates/SKILL_superintendent.md`, and includes that path through its own package packaging configuration. A published consumer must not need to know where the provider stores its raw templates.

Non-goals:

- Do not turn package-lint into a general-purpose asset linter for arbitrary docs, READMEs, tests, examples, screenshots, fixtures, or development-only files.
- Do not require every `.md`, `.hbs`, `.mustache`, or template-looking file in the repo to be shipped.
- Do not add provider-specific branches or package-name exceptions.
- Do not use regex-only source parsing to discover runtime asset paths when a structured parser or TypeScript AST can identify the references.
- Do not automatically edit package manifests or build scripts; this remains a reporting linter.

## 2. User-facing shape

`npm run lint:packages` continues to be the only command. The improvement adds runtime-file awareness to the normal package-lint report and JSON output.

New rule ids:

| id                               | Proves                                                                                                                                                                                  |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `runtime-file-assets-packaged`   | Every package-local file or directory that runtime code can resolve from a finite source expression exists in the built runtime tree and is included by the relevant packaging surface. |
| `runtime-file-assets-collocated` | Runtime code does not read package-owned assets from another package's source tree, another package's dist tree, or a repo-root path that will not exist after publish.                 |

Example rendered output:

```text
package-lint · 13 rules · 60 packages

✖ runtime-file-assets-packaged           (2)
    @poe-code/agent-skill-config
      packages/agent-skill-config/src/templates.ts reads templates/poe-generate.md
      from the built package, but the asset is not included by package files.
      Add a build copy into dist/templates and ensure package.json files includes dist.

    tokenfill
      packages/tokenfill/src/corpus.ts enumerates dist/corpus/*.md at runtime,
      but dist/corpus is not present in the packed artifact.
      Copy src/corpus to dist/corpus during build and include dist in files.

✖ runtime-file-assets-collocated         (1)
    poe-code
      scripts/bundle.mjs copies packages/agent-skill-config/src/templates/poe-generate.md
      into root dist/templates/skill.
      Move the ownership boundary into @poe-code/agent-skill-config or expose a package-local
      asset copy contract instead of reaching into another package's source tree.
```

JSON shape follows existing `Violation`:

```json
{
  "rule": "runtime-file-assets-packaged",
  "package": "@poe-code/agent-skill-config",
  "severity": "error",
  "via": "runtime-file:packages/agent-skill-config/src/templates.ts",
  "detail": {
    "sourceFile": "packages/agent-skill-config/src/templates.ts",
    "runtimePath": "packages/agent-skill-config/dist/templates/poe-generate.md",
    "sourcePath": "packages/agent-skill-config/src/templates/poe-generate.md",
    "packagingSurfaces": ["published-package", "root-files", "bundled-dependency"],
    "missing": ["published-package"]
  },
  "message": "@poe-code/agent-skill-config uses a runtime file asset that is not included in its published artifact",
  "fix": "Copy the asset into dist and include that dist path in package.json files."
}
```

Supported source shapes should be clever enough for the patterns used in this repo:

- `readFile`, `readFileSync`, `createReadStream`, `stat`, `readdir`, and their `node:fs` / `node:fs/promises` namespace forms.
- `new URL("./asset.md", import.meta.url)` and `fileURLToPath(new URL(...))`.
- `path.join`, `path.resolve`, `dirname(fileURLToPath(import.meta.url))`, `import.meta.dirname`, and literals relative to the package root.
- Finite path sets derived from literal arrays or `as const` arrays, such as a known list of template ids.
- Directory reads where the directory itself is the asset boundary, such as a built-in corpus loaded by `readdirSync(corpusDirectoryPath)`.

Dynamic user/workspace files are not package assets. A read like `readFile(options.docPath)` or `readFile(path.resolve(cwd, filePath))` is ignored unless the path expression resolves to a finite path inside the package root.

## 3. Implementation details and technical decisions

### Autonomy audit

- No credentials are required.
- No network is required for the lint run.
- The implementation can use the real workspace files, built `dist` directories, and package manifests already present in the repo.
- Unit tests use `memfs`; they must not create real files.
- Artifact-level verification needs npm pack semantics. Add `npm-packlist` as a dependency of `@poe-code/package-lint` and wrap it behind a small `PacklistProvider` interface so CLI runs use real pack semantics while unit tests pass in in-memory packed file sets.
- The package currently documents no config. This feature adds one package manifest config option, so `packages/package-lint/README.md` must be updated during implementation to document the rule and the config.

### Architecture

Extend the existing `WorkspaceModel` with runtime file asset facts, using the same style as `sourceImports`:

```ts
export interface WorkspaceModel {
  // existing fields...
  runtimeFileAssets: RuntimeFileAssetView;
  packageFiles: PackageFileView;
}
```

`runtimeFileAssets` is discovered by a new TypeScript AST scanner. It walks package `src` files, ignores tests, identifies runtime file operations, and resolves only finite package-local paths. It does not try to understand arbitrary JavaScript.

`packageFiles` is the artifact view used by rules. It contains the actual file list that would be packed for each package plus the root package file set. In CLI runs this comes from `npm-packlist`. In unit tests it is injected or synthesized from in-memory fixtures.

### Runtime File Discovery

Create `packages/package-lint/src/runtime-files.ts`.

Discovery has two phases:

1. Build a local symbol table for each source file:
   - imports from `node:fs`, `node:fs/promises`, `node:path`, and `node:url`
   - namespace imports like `import * as fs from "node:fs"`
   - named imports and aliases like `import { readFileSync as read } from "node:fs"`
   - local `const` bindings that can be statically evaluated
   - finite literal arrays and `as const` arrays

2. Visit AST call sites:
   - file reads: `readFile`, `readFileSync`, `createReadStream`, `open`, `stat`, `access`
   - directory reads: `readdir`, `readdirSync`, `opendir`, `cp` where the source is package-local
   - URL/path conversions: `new URL("./asset", import.meta.url)`, `fileURLToPath(...)`
   - path composition: `path.join(...)`, `path.resolve(...)`, `join(...)`, `resolve(...)`, `dirname(...)`

The evaluator returns `Unknown` unless the expression resolves to one of these finite forms:

```ts
type EvaluatedPath =
  | { kind: "file"; packageRelPath: string; runtimeRelPath: string }
  | { kind: "directory"; packageRelPath: string; runtimeRelPath: string };
```

`packageRelPath` is the path as authored in the source tree, such as `src/templates/poe-generate.md`. `runtimeRelPath` is where that file must exist when built code runs, such as `dist/templates/poe-generate.md`. The default mapping is:

- `src/<rest>` referenced from package runtime code maps to `dist/<rest>`.
- `dist/<rest>` stays `dist/<rest>`.
- paths already outside `src` or `dist` are package-local source assets and must be explicitly declared or moved; otherwise they violate packaging/collocation depending on usage.

### Manifest Escape Hatch

Add an optional package manifest field for finite dynamic runtime assets:

```json
{
  "poeCode": {
    "runtimeAssets": [
      "dist/templates",
      "dist/corpus",
      { "source": "src/templates", "runtime": "dist/templates" }
    ]
  }
}
```

Rules:

- Strings are runtime paths that must be present in the packed artifact.
- Object entries map a source path to a runtime path; both must stay inside the package.
- This is for assets that cannot be inferred precisely from source but are still finite and package-owned.
- It is not a suppression mechanism. A declared asset must still exist and be packed.

`PackageInfo` gets:

```ts
runtimeAssets: RuntimeAssetDeclaration[];
```

The loader parses this field structurally from `package.json`. No regexes and no provider-specific branches.

### Packaging Surfaces

For each runtime file asset, determine which artifact can execute the package:

- `published-package`: package is a genuinely published npm package, so its own packlist must include the asset's `runtimeRelPath`.
- `root-files`: root `package.json.files` ships `packages/<pkg>/dist` or a root bin points into that package, so the root packlist must include `packages/<pkg>/<runtimeRelPath>`.
- `bundled-dependency`: another genuinely published package lists this package in `bundledDependencies`, so that publisher's packlist must include `node_modules/<dep>/<runtimeRelPath>` after prepack vendoring, or the rule must report that the asset cannot be proven bundled.

The first implementation should implement `published-package` and `root-files` directly from `npm-packlist`. For `bundled-dependency`, implement the rule against the package's own packlist first, because npm bundles the dependency tarball contents. A follow-up may inspect prepared `node_modules` if package-lint later gains prepack simulation.

### Collocation Rule

`runtime-file-assets-collocated` reports when a runtime file expression resolves outside the owning package:

- `packages/a/src/...` reading `packages/b/src/...`
- `packages/a/src/...` reading `packages/b/dist/...`
- package runtime code reading a repo-root file that is not under its own package root

The rule ignores reads of user/workspace inputs and generated outputs because those are not package-owned assets. It also ignores tests.

### Packaged Rule

`runtime-file-assets-packaged` reports when a collocated package asset is required at runtime but cannot be found in all required artifact surfaces.

For files:

- source path exists in the package source tree when `sourcePath` is known
- runtime path exists in the built runtime tree
- runtime path appears in every relevant packlist

For directories:

- runtime directory exists
- runtime directory contains at least one packed file, unless the declaration explicitly allows empty directories later
- every file under the runtime directory that the package owns is included in the relevant packlists

Directory traversal must use structured `readdir`, never shell glob output. If glob-like matching becomes necessary, use a parser/library such as `minimatch` through `npm-packlist` semantics rather than ad hoc regexes.

### Severity

Both new rules are `error`.

`runtime-file-assets-packaged` may produce a `warning` only when the linter found a finite package-local asset reference but could not load packlists because the package has not been built. In normal `npm run lint:packages` after build, missing `dist` assets are errors.

### Performance

The scanner should reuse the existing source-file traversal approach. It parses TypeScript files once per package and only evaluates local AST nodes. It must not run TypeScript type checking, shell out, run builds, or call the network.

Packlists are loaded once per package and cached in `PackageFileView`. If `npm-packlist` is too slow on the whole repo, load packlists only for packages that either have runtime file refs or are artifact surfaces for packages with refs.

## 4. Interfaces and test plan

### Interfaces

Add to `packages/package-lint/src/runtime-files.ts`:

```ts
export type RuntimeFileAssetKind = "file" | "directory";

export interface RuntimeFileAssetRef {
  packageDir: string;
  packageName: string;
  sourceFile: string;
  kind: RuntimeFileAssetKind;
  sourceRelPath?: string;
  runtimeRelPath: string;
  expression: string;
  inferred: true;
}

export interface RuntimeAssetDeclaration {
  sourceRelPath?: string;
  runtimeRelPath: string;
  kind?: RuntimeFileAssetKind;
}

export type RuntimeFileAssetView = Map<string, RuntimeFileAssetRef[]>;

export function scanRuntimeFileAssets(
  fs: LintFs,
  rootDir: string,
  packages: Array<{ name: string; dir: string }>
): Promise<RuntimeFileAssetView>;
```

Add to `packages/package-lint/src/packlist.ts`:

```ts
export type PackagingSurface = "published-package" | "root-files" | "bundled-dependency";

export interface PackageFileSet {
  packageDir: string;
  files: Set<string>;
}

export type PackageFileView = Map<string, PackageFileSet>;

export interface PacklistProvider {
  listPackageFiles(rootDir: string, packageDir: string): Promise<Set<string>>;
}

export function createNpmPacklistProvider(): PacklistProvider;
export function loadPackageFileView(
  provider: PacklistProvider,
  model: Pick<WorkspaceModel, "root" | "packages">
): Promise<PackageFileView>;
```

Add rules:

```ts
export const runtimeFileAssetsCollocated: Rule;
export const runtimeFileAssetsPackaged: Rule;
```

Extend existing types:

```ts
export interface PackageInfo {
  // existing fields...
  runtimeAssets: RuntimeAssetDeclaration[];
}

export interface WorkspaceModel {
  // existing fields...
  runtimeFileAssets: RuntimeFileAssetView;
  packageFiles: PackageFileView;
}
```

### Unit Tests

All unit tests use `memfs` and synthetic package models. They do not create real files.

Create `packages/package-lint/src/runtime-files.test.ts`:

- detects `readFileSync(join(dirname(fileURLToPath(import.meta.url)), "templates", "x.md"))`
- detects `readFile(new URL("./SYSTEM_PROMPT.md", import.meta.url), "utf8")`
- detects finite assets from `const TEMPLATE_IDS = ["a.md", "b.md"] as const` plus `path.join(base, templateId)`
- detects directory assets from `readdirSync(corpusDirectoryPath)`
- ignores `readFile(options.path)`
- ignores `readFile(path.resolve(cwd, filePath))`
- reports an unresolved expression as no asset instead of guessing
- records cross-package asset paths for the collocation rule

Create `packages/package-lint/src/rules/runtime-file-assets-collocated.test.ts`:

- error when package `a` reads `packages/b/src/templates/x.md`
- error when package `a` reads a root `docs/foo.md` path as a runtime asset
- clean when package `a` reads `packages/a/src/templates/x.md`
- clean for test files

Create `packages/package-lint/src/rules/runtime-file-assets-packaged.test.ts`:

- error when `src/templates/x.md` is referenced but `dist/templates/x.md` is missing
- error when `dist/templates/x.md` exists but is absent from the package packlist
- error when root ships `packages/a/dist` but root packlist omits `packages/a/dist/templates/x.md`
- clean when the asset exists and all relevant packlists include it
- clean when a dynamic user file read cannot be resolved to a package-local asset
- directory asset clean when packed directory contains files
- directory asset error when runtime directory is empty or absent
- manifest-declared asset must still exist and be packed

Update `packages/package-lint/src/repo-baseline.test.ts` only if the new rules find real current violations. The baseline remains a factual checklist of current package-lint findings.

### Real-World Test

Run in order:

```sh
npm run build
npm run lint:packages -- --rule runtime-file-assets-packaged
npm run lint:packages -- --rule runtime-file-assets-collocated
npm run lint:packages -- --json
npm test -- packages/package-lint/src
```

Expected observations:

- The two new rules appear in the report.
- `--json` includes violations using the existing `Violation` shape.
- Known good package-local assets such as `packages/tokenfill/dist/corpus` and `packages/agent-skill-config/dist/templates` pass when built and packed.
- Any existing root bundle cross-package source asset copies are reported by `runtime-file-assets-collocated` until moved to package-local ownership or declared through a clean package-local asset contract.

### Must-Work Checklist

- [x] A package reading a package-local finite file gets a `RuntimeFileAssetRef`; proof: unit test in `runtime-files.test.ts`.
- [x] A package reading a user-supplied path gets no asset ref; proof: unit test in `runtime-files.test.ts`.
- [x] A cross-package runtime asset read fails collocation; proof: `runtime-file-assets-collocated.test.ts`.
- [x] A missing `dist` asset fails packaging; proof: `runtime-file-assets-packaged.test.ts`.
- [x] A missing package packlist entry fails packaging; proof: `runtime-file-assets-packaged.test.ts`.
- [x] A root-shipped package asset must appear in the root packlist; proof: `runtime-file-assets-packaged.test.ts`.
- [x] Manifest-declared runtime assets are verified, not blindly accepted; proof: `runtime-file-assets-packaged.test.ts`.
- [x] Real repo package-lint output remains deterministic; proof: `npm run lint:packages -- --json`.

### Rollout

Implement the scanner and rules behind default-on package-lint rules. If current repo violations exist, update `baseline.json` with the new factual violations in the same change, then fix violations in follow-up commits by moving assets to package-local ownership, copying them during build, or adding precise runtime asset declarations.

## 5. Code plan

### Files to create

| File                                                                     | Purpose                                                                  |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------ |
| `packages/package-lint/src/runtime-files.ts`                             | TypeScript AST scanner and finite path evaluator for runtime file usage. |
| `packages/package-lint/src/runtime-files.test.ts`                        | Unit coverage for asset discovery and evaluator behavior.                |
| `packages/package-lint/src/packlist.ts`                                  | `npm-packlist` wrapper and packlist view types.                          |
| `packages/package-lint/src/packlist.test.ts`                             | Unit coverage for packlist view construction using a fake provider.      |
| `packages/package-lint/src/rules/runtime-file-assets-packaged.ts`        | Artifact packaging rule.                                                 |
| `packages/package-lint/src/rules/runtime-file-assets-packaged.test.ts`   | Rule tests for missing runtime assets and packlists.                     |
| `packages/package-lint/src/rules/runtime-file-assets-collocated.ts`      | Package-boundary ownership rule.                                         |
| `packages/package-lint/src/rules/runtime-file-assets-collocated.test.ts` | Rule tests for cross-package and repo-root asset reads.                  |

### Files to change

| File                                              | Change                                                                                                                       |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `packages/package-lint/src/model.ts`              | Parse `poeCode.runtimeAssets`; load `runtimeFileAssets`; load or attach `packageFiles`; expose new model fields.             |
| `packages/package-lint/src/rules/index.ts`        | Register `runtime-file-assets-collocated` and `runtime-file-assets-packaged`.                                                |
| `packages/package-lint/src/fixtures.ts`           | Add helpers for runtime asset refs and fake package file sets.                                                               |
| `packages/package-lint/src/repo-baseline.test.ts` | Update expected baseline only for real current violations.                                                                   |
| `packages/package-lint/baseline.json`             | Update if current repo violations are found.                                                                                 |
| `packages/package-lint/package.json`              | Add `npm-packlist` dependency and package-lint test coverage as needed.                                                      |
| `packages/package-lint/README.md`                 | Document the new rules, the optional `poeCode.runtimeAssets` manifest field, and that no environment variables are required. |

### Build Order

1. Add failing unit tests for `runtime-files.ts` covering finite asset discovery, ignored dynamic paths, and cross-package refs.
2. Implement `runtime-files.ts` until scanner tests pass.
3. Add failing unit tests for `packlist.ts` with a fake provider.
4. Implement `packlist.ts`.
5. Add failing tests for `runtime-file-assets-collocated`.
6. Implement the collocation rule and register it.
7. Add failing tests for `runtime-file-assets-packaged`.
8. Implement the packaged rule and register it.
9. Wire `loadWorkspace` to populate `runtimeFileAssets` and `packageFiles`.
10. Update README and baseline.
11. Run the real-world test commands.

### Implementation Notes

- Keep rule files pure. Source scanning and packlist loading happen in the model layer.
- Keep the finite evaluator conservative. Unknown expressions are ignored unless represented by `poeCode.runtimeAssets`.
- Do not add package-name exceptions. Any special case must be represented as a source pattern the evaluator understands or a manifest declaration.
- Do not shell out to `npm pack` in package-lint. Use `npm-packlist` through `PacklistProvider`.
- Do not run builds from package-lint. Missing built assets are reported as lint failures.
- Keep package-lint offline and deterministic.
