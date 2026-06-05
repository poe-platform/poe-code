# QA: package-lint

Manual checks for `@poe-code/package-lint`. Run from the repo root.

## 1. Rendered report

```sh
npm run lint:packages
```

Expect:

- A header: `package-lint · 11 rules · <N> packages`.
- Clean rules render `<rule-id>    ✓`; the current baseline is empty, so the
  normal summary is `✓ all 11 rules passed` and the exit code is `0`.
- If a regression introduces violations, failing rules are grouped under a red
  `■` header with a `(count)`; each violation lists the package, the `via` field
  in parentheses, a one-line message, and a `↳ fix:` hint on the following line.
- `public-needs-publish-wiring` is a hygiene warning (`▲`): a public package
  with no release workflow / `repository.directory` has no publish path.
- `no-cross-package-relative-import` flags relative imports that escape into a
  sibling package (e.g. `../../mcp-oauth/dist/index.js`) — error in shipped
  code, warning in tests.
- `imported-workspace-dep-unresolvable` flags a published package whose shipped
  source imports a workspace package it neither bundles nor publishes (e.g.
  `terminal-pilot` → `@poe-code/agent-skill-config`).
- `exports-subpath-resolvable` flags a bare subpath import of a workspace package
  (e.g. `toolcraft/cli`) that the target's `exports` map does not expose (clean
  today — a regression guard).
- `lockstep-release-group-valid` validates every `prepare-lockstep-release`
  workflow group: concrete version, at least two unique public npm packages, and
  publish steps for every prepared package.
- `published-bin-must-be-executable` requires genuinely published packages with
  `bin` entries to run `scripts/set-bin-executable.mjs` in `prepack`, preventing
  `tsc`-emitted bins from shipping without executable bits.
- When violations exist, the summary line is `<n> rules failed · <m> violations`
  (with `(k warnings)` when any) and the exit code is `1`. Confirm the current
  clean run exits `0` with `echo $?`.

The import-driven rules parse real `src` imports with the TypeScript compiler,
so they catch undeclared imports that the package.json-based rules cannot.

## 2. JSON output

```sh
npm run lint:packages -- --json
```

Expect valid JSON with `summary` (`packages`, `rules`, `violations`, `ok: true` on the current clean tree),
a `violations` array (each with `rule`, `package`, `severity`, optional `via`,
`detail`, `message`), and `skipped`. Pipe through `node -e` or `jq` to confirm it
parses.

## 3. Single rule

```sh
npm run lint:packages -- --rule no-published-to-private-dep
```

Expect only that rule to run (header shows `1 rules`) and only its violations.

## 4. Build-aware rule participates after a build

```sh
npm run build
npm run lint:packages -- --json
```

Expect `skipped` to be empty (no longer `["bundle-self-contained"]`) because
`dist/metafile.json` now exists, and `bundle-self-contained` to report `✓`
(the bundle inlines every workspace package and externalizes only root deps).

Before any build (or after `rm dist/metafile.json`), expect
`skipped: ["bundle-self-contained"]` and the rendered report to show
`bundle-self-contained    – skipped (needs build)`.

## 5. Baseline regression guard

```sh
npx vitest run packages/package-lint/src/repo-baseline.test.ts
```

Expect green. This asserts the analyzer still finds exactly the violation set in
`packages/package-lint/baseline.json`. The current baseline is empty; if a new
violation is intentionally accepted during rollout, regenerate the baseline and
include the reason in the change.
