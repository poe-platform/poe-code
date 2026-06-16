# @poe-code/package-lint

Static analysis that resolves every workspace package's dependency tree and
verifies it is configured correctly for this mixed published/private monorepo.
Every decision is made from facts — the `private` flag, real vendoring into
`dist/`, dependency edges, release-workflow wiring — never from naming
conventions, and never from the npm registry (offline only).

## Usage

```sh
npm run lint:packages             # human report, non-zero exit on any violation
npm run lint:packages -- --json   # machine-readable, for CI logs / tooling
```

The package bin is `poe-package-lint`.

| Flag           | Effect                                                      |
| -------------- | ----------------------------------------------------------- |
| `--json`       | Emit violations as JSON instead of the rendered report.     |
| `--quiet`      | Print only violations, suppress the per-rule "clean" lines. |
| `--rule <id>`  | Run a single rule by id (repeatable); default runs all.     |
| `-h`, `--help` | Show help.                                                  |

Exit codes: `0` clean · `1` violations found · `2` tool error (unreadable or
malformed `package.json`).

## Rules

| id                                      | Proves                                                                                                                                                                                                                            |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `shipped-dist-deps-unresolvable`        | Every runtime dependency of a shipped, tsc-emitted bin entry resolves from the published tarball — it is in root `dependencies`, a Node builtin, or itself a shipped package.                                                     |
| `no-published-to-private-dep`           | No published package depends (deps / peer / optional) on a private workspace package.                                                                                                                                             |
| `published-dep-needs-version-range`     | A published → published workspace dependency uses a concrete range, never `*` / `workspace:*`.                                                                                                                                    |
| `public-needs-publish-wiring`           | Hygiene: a public package with no release workflow or no `repository.directory` has no publish path (warning). Whether it is actually needed on npm is decided from real imports below, not declarations.                         |
| `release-workflow-maps-to-package`      | Every release workflow publishes an existing, non-private (or pypi) package.                                                                                                                                                      |
| `no-cross-package-relative-import`      | No source file imports a sibling package by a relative path that escapes its own directory (e.g. `../../mcp-oauth/dist/index.js`); import the sibling by package name. Error in shipped code, warning in tests.                   |
| `imported-workspace-dep-unresolvable`   | Import-driven: every workspace package a published package's shipped source actually imports (runtime, non-type-only) is vendored (`bundledDependencies`) or itself reaches npm. Catches undeclared imports of private packages.  |
| `exports-subpath-resolvable`            | Import-driven: a bare subpath import of a workspace package (e.g. `toolcraft/cli`) is a subpath the target's `exports` map exposes. Node gates `exports` — an unlisted subpath is `ERR_PACKAGE_PATH_NOT_EXPORTED` once published. |
| `bundle-self-contained` _(build-aware)_ | The bundled entry inlines every referenced workspace package and externalizes nothing absent from root `dependencies`. Consumes `dist/metafile.json`; skipped when absent.                                                        |
| `package-readme-required`               | Every workspace package under `packages/*` has a package-local `README.md` documenting env vars and config options.                                                                                                                |

Imports are parsed with the TypeScript compiler's own scanner (the engine
`typescript-eslint` runs on) over each package's `src`, so the import-driven
rules reflect what the code actually imports, not what `package.json` declares.

A package with a Python project file (`pyproject.toml` / `setup.py` /
`setup.cfg`) is tagged `pypi` and exempt from the npm rules.

## Configuration

No environment variables and no config file. Behavior is controlled entirely by
the flags above; all rules run by default.
