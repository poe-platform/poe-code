# Audit: `@modelcontextprotocol/sdk` Must Stay Dev-Only

Date: 2026-04-26

Final verdict: **PASS**

## Scope

- Walk every shipped workspace manifest under `packages/*/package.json` and verify `@modelcontextprotocol/sdk` appears only in `devDependencies`.
- Cross-check `package-lock.json` for non-dev resolution paths.
- Audit the new packages from this plan:
  - `tiny-oauth-test-server`
  - `tiny-http-mcp-oauth-test-server`
  - `mcp-oauth`
- Confirm none of those new packages imports the SDK from `src/index.ts` or any module reachable from it.

## Manifest Audit

Scanned `46` workspace `package.json` files under `packages/*/package.json`.
Nested dependency manifests under package-local `node_modules/` were excluded because they are not monorepo packages this repository ships.

Only five packages mention `@modelcontextprotocol/sdk`, and every mention is under `devDependencies`.

| Package | SDK present? | Key | Imported from source files | Verdict |
| --- | --- | --- | --- | --- |
| `tiny-http-mcp-oauth-test-server` | Yes | `devDependencies` (`^1.26.0`) | No direct SDK imports in-package. Runtime entry [`src/index.ts`](../../../packages/tiny-http-mcp-oauth-test-server/src/index.ts) now imports runtime-safe helpers from `tiny-http-mcp-server` main export instead of `tiny-http-mcp-server/testing`. | Pass |
| `tiny-http-mcp-server` | Yes | `devDependencies` (`^1.26.0`) | SDK imports remain in [`src/testing.ts`](../../../packages/tiny-http-mcp-server/src/testing.ts) and test files such as [`src/tiny-http-mcp-server.test.ts`](../../../packages/tiny-http-mcp-server/src/tiny-http-mcp-server.test.ts) and [`src/sdk-oauth-interop.test.ts`](../../../packages/tiny-http-mcp-server/src/sdk-oauth-interop.test.ts). Runtime-safe helpers were split into [`src/test-support.ts`](../../../packages/tiny-http-mcp-server/src/test-support.ts). | Pass |
| `tiny-mcp-client` | Yes | `devDependencies` (`^1.26.0`) | SDK imports appear in [`src/internal.ts`](../../../packages/tiny-mcp-client/src/internal.ts) plus test files. This audit task did not change that package; the manifest rule still passes because the SDK is not in `dependencies`, `peerDependencies`, or `optionalDependencies`. | Pass |
| `tiny-stdio-mcp-server` | Yes | `devDependencies` (`^1.25.3`) | SDK imports appear in [`src/testing.ts`](../../../packages/tiny-stdio-mcp-server/src/testing.ts). | Pass |
| `tiny-stdio-mcp-test-server` | Yes | `devDependencies` (`^1.25.3`) | No in-package SDK source import was found; the manifest entry is still dev-only. | Pass |

Packages with **no** SDK manifest entry include the new packages [`tiny-oauth-test-server`](../../../packages/tiny-oauth-test-server/package.json) and [`mcp-oauth`](../../../packages/mcp-oauth/package.json).

## Lockfile Audit

`package-lock.json` is consistent with the manifest rule.

- The resolved SDK entry at `packages["node_modules/@modelcontextprotocol/sdk"]` is marked `dev: true`.
- The only package ownership edges to the SDK are:
  - `packages/tiny-http-mcp-oauth-test-server` via `devDependencies`
  - `packages/tiny-http-mcp-server` via `devDependencies`
  - `packages/tiny-mcp-client` via `devDependencies`
  - `packages/tiny-stdio-mcp-server` via `devDependencies`
  - `packages/tiny-stdio-mcp-test-server` via `devDependencies`
- No `dependencies`, `peerDependencies`, or `optionalDependencies` edge to the SDK exists anywhere in the lockfile.

Lockfile verdict: **Pass**

## New-Package Runtime Import Audit

| Package | SDK present? | Imported from source files | Runtime-entry verdict |
| --- | --- | --- | --- |
| `tiny-oauth-test-server` | No | None | Pass |
| `tiny-http-mcp-oauth-test-server` | Yes, but only in `devDependencies` | No direct SDK import. Runtime entry [`src/index.ts`](../../../packages/tiny-http-mcp-oauth-test-server/src/index.ts) now resolves only through `tiny-http-mcp-server` main exports and does not reach `tiny-http-mcp-server/testing`. | Pass |
| `mcp-oauth` | No | None | Pass |

## Guardrail Added

- Repo-wide invariant test: [`packages/github-workflows/src/sdk-dependency-audit.test.ts`](../../../packages/github-workflows/src/sdk-dependency-audit.test.ts)
- Shared assertion used by both test and CI: [`packages/github-workflows/src/sdk-dependency-audit.ts`](../../../packages/github-workflows/src/sdk-dependency-audit.ts)
- CI entrypoint: [`packages/github-workflows/scripts/assert-mcp-sdk-dev-deps.ts`](../../../packages/github-workflows/scripts/assert-mcp-sdk-dev-deps.ts)
- Workflow step: [`.github/workflows/pr-checks.yml`](../../../.github/workflows/pr-checks.yml)

Overall verdict: **PASS**
