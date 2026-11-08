# QA: package-lint

Manual checks for `@poe-code/package-lint`. Run from the repo root.

## 1. Rendered report

```sh
npm run lint:packages
```

Expect:

- A header: `package-lint · 14 rules · <N> packages`.
- One line per rule.
- Passing rules render `<rule-id>    ✓`.
- The current repo baseline ends with `✓ all 14 rules passed`.
- Exit code is `0`.

When a rule fails, expect:

- failures grouped under a red `■` header with a `(count)`;
- warnings grouped under a yellow `▲` header;
- each violation lists the package, optional `via` field, one-line message, and
  `↳ fix:` hint;
- a summary line such as `<n> rules failed · <m> violations`;
- exit code `1`.

Important rules:

- `public-needs-publish-wiring` is a hygiene warning: a public package with no
  release workflow or `repository.directory` has no publish path.
- `no-cross-package-relative-import` flags relative imports that escape into a
  sibling package. This is an error in shipped code and a warning in tests.
- `imported-workspace-dep-unresolvable` flags a published package whose shipped
  source imports a workspace package it neither bundles nor publishes.
- `exports-subpath-resolvable` flags a bare subpath import of a workspace package
  that the target's `exports` map does not expose.

The import-driven rules parse real `src` imports with the TypeScript compiler,
so they catch undeclared imports that the package.json-based rules cannot.

## 2. JSON output

```sh
npm run lint:packages -- --json
```

Expect valid JSON with:

- `summary.packages`
- `summary.rules`
- `summary.violations`
- `summary.ok`
- `violations`
- `skipped`

On the current clean baseline, `summary.ok` is `true` and `violations` is empty.
Pipe through `node -e` or `jq` to confirm it parses.

## 3. Single rule

```sh
npm run lint:packages -- --rule no-published-to-private-dep
```

Expect only that rule to run. The header shows `1 rules`.

## 4. Build-aware rule participates after a build

```sh
npm run build
npm run lint:packages -- --json
```

Expect `skipped` to be empty (no longer `["bundle-self-contained"]`) because
`dist/metafile.json` now exists. `bundle-self-contained` should report `✓`.

Before any build (or after `rm dist/metafile.json`), expect
`skipped: ["bundle-self-contained"]` and the rendered report to show
`bundle-self-contained    – skipped (needs build)`.

## 5. Baseline regression guard

```sh
npx vitest run packages/package-lint/src/repo-baseline.test.ts
```

Expect green. This asserts the analyzer still finds the violation set recorded in
`packages/package-lint/baseline.json`. When a violation is fixed, regenerate the
baseline so the set shrinks toward `[]`.
